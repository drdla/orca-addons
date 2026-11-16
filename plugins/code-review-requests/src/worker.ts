// The plugin's worker. Orca transpiles this file on load; a save, update or crash restarts it and
// drops its memory, so anything that must last goes in orca.storage.
//
// activate() must stay side-effect-free until GitLab is configured: `orca plugin check` runs the
// real worker once per scenario, with the CLI's full environment, so starting a poll, spawning
// glab or the orca CLI there would call out for real. "Configured" means the settings hold an
// instanceUrl: real Orca fills in the declared defaults, the test kit and `check` do not (see
// isConfigured). So a check scenario must never seed `instanceUrl`.
//
// Wiring only: the poll schedule lives in poll/poller.ts, what polls learn in poll/poll-state.ts
// (with its listener extension points), the bell in status-bar.ts.
import type { OrcaWorkerApi } from 'orca/worker'
import { connectionFor } from './connection'
import { realDeps, type Deps } from './deps'
import { fetchReviewRequests, fetchUsername } from './gitlab/fetch-review-requests'
import { clockTime, createFailureHandling } from './poll/failures'
import { createPollState, snapshotOf, type PollState } from './poll/poll-state'
import { createPoller, type Poller } from './poll/poller'
import { explainDropped } from './notify/explain-dropped'
import { createNotifier } from './notify/notifier'
import { redactError } from './gitlab/http-response'
import { createTokenMode } from './token-mode'
import type { ReviewRequestCard, ReviewRequestsSnapshot, ReviewRequestView } from './protocol'
import { GitLabError, type GitLabConnection, type GitLabTransport } from './seams/gitlab'
import { DEFAULT_SETTINGS, readSettings, type Settings } from './settings'
import { createStatusBar } from './status-bar'
import { applyFilters, parseFilters, passesFilters } from './filters'
import { createRequestedAtCache } from './gitlab/requested-at'
import { overdueRefiner, type OverdueContext } from './to-review'
import { isOverdue } from './overdue'
import {
  createWorkspaceTracker,
  hasWorkspace,
  withWorkspaces,
  type DraftCounts
} from './workspaces/workspace-tracker'
import { createSeenTracker, seenRefiner } from './seen'
import { isPosted, isUnposted } from './review-draft/review-drafts'
import { createReviewActions, hostWorkspaceIdOf } from './workspaces/review-actions'
import { createEndedWorkspaces } from './ended/ended-workspaces'
import { registerDraftRequests } from './review-draft/draft-requests'
import { registerPostRequests } from './review-draft/post-requests'
import { createReviewDrafts } from './review-draft/review-drafts'

export const REFRESH_COMMAND = 'code-review-requests.refresh'
export const OPEN_COMMAND = 'code-review-requests.open'
const PANEL_ID = 'review-requests'

const MINUTE = 60_000

/** True once the settings hold an instance URL (Orca fills it from the manifest default). */
async function isConfigured(orca: OrcaWorkerApi): Promise<boolean> {
  const stored = await orca.settings.get()
  return typeof stored.instanceUrl === 'string' && stored.instanceUrl.trim() !== ''
}

function intervalMsOf(settings: Settings): number {
  return Math.max(1, settings.pollMinutes) * MINUTE
}

/** Builds the worker module over the given seams; tests pass fakeDeps().deps. */
export function createWorker(deps: Deps) {
  let stopWorker: (() => void) | null = null

  async function activate(orca: OrcaWorkerApi): Promise<void> {
    const state = createPollState((message) => orca.log(message))
    let overdueHours = DEFAULT_SETTINGS.overdueHours
    const overdue: OverdueContext = { now: () => deps.clock.now(), overdueHours: () => overdueHours }
    const gitLab = createGitLabSource(deps)
    let connectionKey: string | null = null
    // Review Workspaces (#27): one `orca worktree list` per poll; a failure only disables them.
    const workspaces = createWorkspaceTracker(deps.orcaCli, (message) => orca.log(message))
    // Filters (#26). A Review Request with a Review Workspace is never hidden; the lookup uses the
    // worktree list poll() refreshed before applyFilters.
    const hasReviewWorkspace = (view: ReviewRequestView): boolean => hasWorkspace(workspaces.current(), view)
    // The Review Drafts (#29), read by posting and removal (#30).
    const drafts = createReviewDrafts(orca.storage, deps.clock)
    // Ended Review Requests with a Review Workspace, and removing those workspaces (#28).
    const ended = createEndedWorkspaces({
      storage: orca.storage,
      cli: deps.orcaCli,
      git: deps.git,
      host: orca.host,
      clock: deps.clock,
      workspaces,
      autoRemoveDays: async () => (await readSettings(orca.settings)).autoRemoveDays,
      // Unposted Review Comments make manual removal ask and auto-removal skip (#30); once the
      // workspace is gone, by any route, its Review Draft goes too.
      unpostedReviewComments: async (entry) => (await drafts.toPost(entry.url)).length,
      onRemoved: (entry) => drafts.remove(entry.url),
      forgeHost: () => host,
      log: (message) => orca.log(message)
    })
    await ended.load()
    let filters = parseFilters(DEFAULT_SETTINGS)
    let filtersKey = ''
    /** Shown in the list and allowed to notify: has a Review Workspace or passes the filters. */
    const isShown = (view: ReviewRequestView) => hasReviewWorkspace(view) || passesFilters(view, filters.filters)
    /** The host the last poll tried, or null if the instance URL is no URL. */
    let host: string | null = null
    /** While glab is logged out of `host`: the other hosts it is logged in to (#8). */
    let glabHosts: string[] = []

    async function poll(): Promise<void> {
      const at = deps.clock.now()
      await workspaces.refresh()
      let token: string | null = null
      let glabPath: string | null = null
      try {
        const settings = await readSettings(orca.settings)
        host = null
        const connection = await connectionFor(settings, orca.secrets)
        host = connection.host
        token = connection.token
        glabPath = connection.glabPath
        const all = await gitLab.reviewRequests(connection)
        filters = parseFilters(settings)
        const { visible, hidden } = applyFilters(all, filters.filters, hasReviewWorkspace)
        glabHosts = []
        await state.record({ ok: true, at, host: connection.host, reviewRequests: visible, hidden })
      } catch (caught) {
        // glab is logged out of this host: which others is it logged in to? ("Use <host>", #8)
        glabHosts = []
        if (caught instanceof GitLabError && caught.reason === 'logged-out' && token === null && host !== null) {
          const loggedOutOf = host
          const others = await deps.glab.loggedInHosts(glabPath).catch(() => [])
          glabHosts = others.filter((other) => other !== loggedOutOf)
        }
        // A token GitLab or the network echoes back must not reach logs, the panel or the bell.
        const error = redactError(caught, token)
        orca.log(`poll failed: ${error instanceof Error ? error.message : String(error)}`)
        await state.record({ ok: false, at, error })
      }
    }

    // applySettings() sets the real interval before the first start.
    let intervalMs = DEFAULT_SETTINGS.pollMinutes * MINUTE
    const poller: Poller = createPoller({ clock: deps.clock, intervalMs, poll })
    const failures = createFailureHandling({
      clock: deps.clock,
      poller,
      intervalMs: () => intervalMs,
      host: () => host,
      storage: orca.storage,
      notify: (notification) => orca.host.call('notifications.show', notification)
    })
    // What the panel has shown, per host: the cards' New mark and the bell's "M new" (#10).
    const seen = createSeenTracker(orca.storage)
    // The problem states replace the whole look, so they come last.
    const statusBar = createStatusBar(orca, [seenRefiner(seen), overdueRefiner(overdue), failures.refineStatusBar])

    // Features hang off the poll state here, one listener each (see poll/poll-state.ts):
    // diffing for notifications (#23) on onSucceeded, failure handling (#24) on onFailed with
    // `poller` for backoff, panel posts (#22) on onChange. onChange listeners run after every
    // onSucceeded/onFailed one, so the bell always draws a fully handled outcome.
    state.onFailed(failures.onFailed)
    state.onSucceeded(failures.onSucceeded)
    const notifier = createNotifier({
      storage: orca.storage,
      show: (note) => orca.host.call('notifications.show', note),
      intervalMs: async () => intervalMsOf(await readSettings(orca.settings)),
      explainDropped: async (dropped, forHost) => {
        const connection = await connectionFor(await readSettings(orca.settings), orca.secrets)
        // Never look an MR up on another host than the one that listed it (#7).
        if (connection.host !== forHost) return new Map()
        return gitLab.explainDropped(connection, dropped)
      },
      isShown,
      isOverdue: (view) => isOverdue(view.requestedAt, deps.clock.now(), overdueHours),
      // The Ended tab (#28) keeps the Ended ones that have a Review Workspace.
      onDropped: (dropped, at) => ended.onDropped(dropped, at),
      log: (message) => orca.log(message)
    })
    // The notifier diffs the whole list (shown and hidden), so changing a filter never looks like
    // a new or an Ended Review Request; isShown keeps hidden ones out of the notifications.
    state.onSucceeded((_previous, next) =>
      notifier.onGoodPoll([...next.reviewRequests, ...next.hidden], next.lastSuccessAt!, next.host!)
    )
    // Ended tab (#28): Review Requests listed again leave it; each tick (good poll or not) forgets
    // entries whose workspace is gone and auto-removes the clean ones past the deadline.
    state.onSucceeded((_previous, next) => ended.onListed([...next.reviewRequests, ...next.hidden]))
    state.onSucceeded((_previous, next) => seen.onGoodPoll(next.host!, next.reviewRequests))
    state.onChange(async () => {
      await ended.tick()
    })
    state.onChange((current) => statusBar.render(current))
    state.onChange(async () => orca.panels.post('rr.changed', await snapshot()))

    /** Starts, stops or re-times polling to match the settings. */
    async function applySettings(options: { pollAtOnce?: boolean } = {}): Promise<void> {
      const current = await readSettings(orca.settings)
      overdueHours = current.overdueHours
      filters = parseFilters(current)
      const previousFiltersKey = filtersKey
      filtersKey = [current.pathAllowlist, current.pathBlocklist, current.authorBlocklist].join('\n')
      if (!(await isConfigured(orca))) {
        poller.stop()
        connectionKey = null
        return
      }
      const settings = await readSettings(orca.settings)
      intervalMs = intervalMsOf(settings)
      poller.setIntervalMs(intervalMs)
      const key = keyOf(await connectionFor(settings, orca.secrets).catch(() => null))
      if (!poller.running) {
        // Needs you stays stopped until the connection changes (or Retry, or a restart).
        if (failures.needsYou() && key === connectionKey) return
        connectionKey = key
        poller.start()
        if (options.pollAtOnce) await poller.pollNow()
      } else if (key !== connectionKey || (filtersKey !== previousFiltersKey && failures.rateLimitedUntil() === null)) {
        // A changed filter polls too (unless rate-limited), so the list and the bell follow it at once.
        connectionKey = key
        await poller.pollNow()
      }
    }

    /** The Review Draft counts of the listed Review Requests, as of the last snapshot(). */
    let draftCounts = new Map<string, DraftCounts>()

    /** The panel's view, with each card's Review Draft counts read afresh. */
    async function snapshot(): Promise<ReviewRequestsSnapshot> {
      const next = new Map<string, DraftCounts>()
      for (const { url } of state.current().reviewRequests) {
        const comments = (await drafts.get(url))?.comments ?? []
        next.set(url, {
          unposted: comments.filter((c) => !isPosted(c)).length,
          toPost: comments.filter(isUnposted).length
        })
      }
      draftCounts = next
      return viewNow()
    }

    /**
     * The panel's view: the poll state plus, while GitLab fails, the problem (#24), with each
     * card's Review Workspace, Agent Review, New mark and the last read Review Draft counts.
     */
    function viewNow(): ReviewRequestsSnapshot {
      const current = state.current()
      let problem = failures.problemView(current)
      if (problem?.status === 'needs-you' && problem.reason === 'logged-out' && glabHosts.length > 0) {
        problem = { ...problem, glabHosts }
      }
      const base = snapshotOf(current, overdue)
      return withWorkspaces(
        {
          ...base,
          reviewRequests: base.reviewRequests.map((card) => ({ ...card, isNew: seen.isNew(current.host, card.url) })),
          ...(problem === undefined ? {} : { gitlab: problem }),
          ...(filters.invalid.length === 0 ? {} : { invalidFilterEntries: filters.invalid }),
          ...endedView()
        },
        workspaces.current(),
        (url) => draftCounts.get(url) ?? { unposted: 0, toPost: 0 }
      )
    }

    /** The Ended tab, and whether workspace actions are off (#28). */
    function endedView(): Pick<ReviewRequestsSnapshot, 'ended' | 'workspacesUnavailable'> {
      const current = workspaces.current()
      const entries = ended.entries()
      return {
        ...(entries.length === 0 ? {} : { ended: entries }),
        ...(current.kind === 'unavailable' ? { workspacesUnavailable: current.reason } : {})
      }
    }

    orca.panels.handle('rr.snapshot', async () => snapshot())
    // The panel opened (#10): what it lists is seen; the bell drops it from "M new" at once.
    orca.panels.handle('rr.markSeen', async () => {
      const current = state.current()
      if (current.host !== null) await seen.markSeen(current.host, current.reviewRequests)
      await statusBar.render(current)
      return { seen: true as const }
    })
    // Also the panel's Retry / Check again; it waits out a rate limit instead of polling.
    orca.panels.handle('rr.refresh', async () => {
      if ((await isConfigured(orca)) && failures.rateLimitedUntil() === null) await poller.pollNow()
      return snapshot()
    })
    orca.panels.handle('rr.copyLink', async ({ url }) => {
      await deps.desktop.copyText(url)
      return { copied: true as const }
    })
    orca.panels.handle('rr.copyText', async ({ text }) => {
      await deps.desktop.copyText(text)
      return { copied: true as const }
    })
    // "Use <host>" (#8): the instance URL is the single source of truth, so this only sets it.
    orca.panels.handle('rr.useHost', async ({ host: picked }) => {
      if (!glabHosts.includes(picked)) throw new Error(`glab is not logged in to ${picked}.`)
      await orca.settings.set('instanceUrl', `https://${picked}`)
      await applySettings({ pollAtOnce: true })
      return snapshot()
    })
    // Review Workspace actions (#27). Start review answers the new snapshot and tells open panels.
    const reviewActions = createReviewActions({
      cli: deps.orcaCli,
      git: deps.git,
      host: orca.host,
      workspaces,
      settings: () => readSettings(orca.settings),
      reviewRequest: (url) => state.current().reviewRequests.find((rr) => rr.url === url)
    })
    orca.panels.handle('rr.startReview', async ({ url, withAgent }) => {
      try {
        await reviewActions.startReview(url, withAgent)
      } finally {
        await orca.panels.post('rr.changed', await snapshot())
      }
      return snapshot()
    })
    orca.panels.handle('rr.openWorkspace', async ({ url }) => {
      if (ended.has(url)) {
        // An Ended Review Request is off the list; open its workspace by path (#28).
        const workspaceId = await hostWorkspaceIdOf(orca.host, ended.entry(url).workspace)
        await orca.host.call('workspace.open', { workspaceId })
      } else {
        await reviewActions.openWorkspace(url)
      }
      return { opened: true as const }
    })
    orca.panels.handle('rr.checkRemoval', async ({ url }) => ended.checkRemoval(url))
    orca.panels.handle('rr.removeWorkspace', async ({ url, force }) => {
      try {
        await ended.remove(url, force)
      } finally {
        await orca.panels.post('rr.changed', await snapshot())
      }
      return snapshot()
    })
    // A workspace removed anywhere (here, in Orca, by the CLI): its Ended entry goes (#7).
    const removedWatch = orca.events.on('workspace.removed', async ({ path }) => {
      await workspaces.refresh()
      await ended.onWorkspaceRemoved(path)
      await orca.panels.post('rr.changed', await snapshot())
    })
    orca.panels.handle('rr.runAgentReview', async ({ url }) => {
      await reviewActions.runAgentReview(url)
      return { started: true as const }
    })
    // The Review Draft (#29): import and curation, also for an Ended Review Request whose
    // workspace is still there; posting it (#30).
    const draftCards = (): ReviewRequestCard[] => [
      ...viewNow().reviewRequests,
      ...ended.entries().map((entry) => ({ ...entry, overdue: false }))
    ]
    // The cards show their Review Draft's counts (#10), so open panels hear of each change.
    const draftChanged = async () => {
      await orca.panels.post('rr.changed', await snapshot())
    }
    registerDraftRequests(orca, {
      deps,
      cards: draftCards,
      workspaceState: () => workspaces.current(),
      onChanged: draftChanged
    })
    registerPostRequests(orca, {
      drafts,
      cards: draftCards,
      connection: async () => {
        const connection = await connectionFor(await readSettings(orca.settings), orca.secrets)
        return { transport: deps.gitLab(connection), token: connection.token }
      },
      onChanged: draftChanged
    })

    // Token mode and the Connection section (#25).
    const tokenMode = createTokenMode({
      deps,
      secrets: orca.secrets,
      protection: async () => {
        const answer = await orca.host.call('secrets.protection').catch(() => null)
        return answer?.status === 'unavailable' ? 'unavailable' : 'os-keyring'
      },
      settings: () => readSettings(orca.settings),
      isConfigured: () => isConfigured(orca),
      onTokenChanged: () => applySettings({ pollAtOnce: true })
    })
    orca.panels.handle('rr.connection', async ({ test }) => tokenMode.view(test))
    orca.panels.handle('rr.saveToken', async ({ token }) => tokenMode.save(token))
    orca.panels.handle('rr.removeToken', async () => tokenMode.remove())
    orca.commands.register(OPEN_COMMAND, async () => {
      // A string result is shown as-is; nothing to say when it worked.
      return deps.desktop.openPanel(PANEL_ID).then(
        () => undefined,
        (error: unknown) => `Couldn't open the Review Requests panel: ${String(error)}`
      )
    })
    orca.commands.register(REFRESH_COMMAND, async () => {
      if (!(await isConfigured(orca))) return 'GitLab is not set up yet.'
      const limitedUntil = failures.rateLimitedUntil()
      if (limitedUntil !== null) return `Rate-limited until ${clockTime(limitedUntil)}.`
      await poller.pollNow()
      return refreshSummary(state.current())
    })
    // Returns the promise so a caller that awaits listeners (the tests) can; Orca ignores it.
    const settingsWatch = orca.settings.onDidChange(() =>
      applySettings().catch((error: unknown) => orca.log(`settings: ${String(error)}`))
    )
    stopWorker = () => {
      settingsWatch.dispose()
      removedWatch.dispose()
      poller.stop()
    }

    // The item lasts until Orca restarts; hide it until a poll has something to count.
    await statusBar.render(state.current()).catch(() => {})
    await applySettings()
  }

  return {
    default: activate,
    deactivate(): void {
      stopWorker?.()
      stopWorker = null
    }
  }
}

/** One transport and username per connection, rebuilt when the connection changes. */
function createGitLabSource(deps: Deps) {
  let cached: { key: string; transport: GitLabTransport; me: string | null } | null = null
  const requestedAt = createRequestedAtCache()
  async function sourceFor(connection: GitLabConnection) {
    const key = keyOf(connection)
    if (cached?.key !== key) cached = { key, transport: deps.gitLab(connection), me: null }
    const source = cached
    source.me ??= await fetchUsername(source.transport)
    return { transport: source.transport, me: source.me }
  }
  return {
    async reviewRequests(connection: GitLabConnection) {
      const { transport, me } = await sourceFor(connection)
      return requestedAt.apply(transport, me, await fetchReviewRequests(transport, me))
    },
    async explainDropped(connection: GitLabConnection, dropped: ReviewRequestView[]) {
      const { transport, me } = await sourceFor(connection)
      return explainDropped(transport, me, dropped)
    }
  }
}

function keyOf(connection: GitLabConnection | null): string {
  return connection === null ? '' : `${connection.host}\n${connection.token ?? ''}\n${connection.glabPath ?? ''}`
}

function refreshSummary(state: PollState): string {
  if (state.lastError !== null) {
    const reason = state.lastError instanceof Error ? state.lastError.message : String(state.lastError)
    return `Couldn't refresh Review Requests: ${reason}`
  }
  const count = state.reviewRequests.length
  return `${count} ${count === 1 ? 'Review Request' : 'Review Requests'}.`
}

const worker = createWorker(realDeps())
export default worker.default
export const deactivate = worker.deactivate
