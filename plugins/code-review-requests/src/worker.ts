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
// (with its listener extension points), the bell in status-bar.ts, and each group of panel
// requests in its feature's register… module.
import type { OrcaWorkerApi } from 'orca/worker'
import { connectionFor } from './connection'
import { connectionKeyOf, type ConnectionKey } from './connection-key'
import { registerConnectionRequests } from './connection-requests'
import { realDeps, type Deps } from './deps'
import { createEndedWorkspaces } from './ended/ended-workspaces'
import { messageOf } from './errors'
import { applyFilters, filtersKeyOf, parseFilters, passesFilters, type FiltersKey } from './filters'
import { createGitLabSource } from './gitlab/gitlab-source'
import { redactError } from './gitlab/http-response'
import { createNotifier } from './notify/notifier'
import { isOverdue } from './overdue'
import { clockTime, createFailureHandling } from './poll/failures'
import { createPollState, snapshotOf, type PollState } from './poll/poll-state'
import { createPoller } from './poll/poller'
import type { ReviewRequestCard, ReviewRequestsSnapshot, ReviewRequestView } from './protocol'
import { registerDraftRequests } from './review-draft/draft-requests'
import { registerPostRequests } from './review-draft/post-requests'
import { createReviewDrafts, isPosted, isUnposted } from './review-draft/review-drafts'
import { GitLabError, type GitLabConnection } from './seams/gitlab'
import { createSeenTracker, seenRefiner } from './seen'
import { DEFAULT_SETTINGS, readSettings, type Settings } from './settings'
import { createStatusBar } from './status-bar'
import { overdueRefiner, type OverdueContext } from './to-review'
import type { WorkspaceContext } from './workspaces/workspace-context'
import { registerWorkspaceRequests } from './workspaces/workspace-requests'
import {
  createWorkspaceTracker,
  hasWorkspace,
  withWorkspaces,
  type DraftCounts
} from './workspaces/workspace-tracker'

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
    const log = (message: string) => orca.log(message)
    const settings = () => readSettings(orca.settings)
    /** The connection the settings and secrets describe now. */
    const currentConnection = async (): Promise<GitLabConnection> => connectionFor(await settings(), orca.secrets)

    const state = createPollState(log)
    let overdueHours = DEFAULT_SETTINGS.overdueHours
    const overdue: OverdueContext = { now: () => deps.clock.now(), overdueHours: () => overdueHours }
    const gitLab = createGitLabSource(deps)
    let connectionKey: ConnectionKey | null = null
    /** The host the last poll tried, or null if the instance URL is no URL. */
    let host: string | null = null
    /** While glab is logged out of `host`: the other hosts it is logged in to (#8). */
    let glabHosts: string[] = []

    // Review Workspaces (#27): one `orca worktree list` per poll; a failure only disables them.
    const workspaces = createWorkspaceTracker(deps.orcaCli, log)
    const context: WorkspaceContext = {
      cli: deps.orcaCli,
      git: deps.git,
      host: orca.host,
      clock: deps.clock,
      workspaces,
      log
    }
    // Filters (#26). A Review Request with a Review Workspace is never hidden; the lookup uses the
    // worktree list poll() refreshed before applyFilters.
    const hasReviewWorkspace = (view: ReviewRequestView): boolean => hasWorkspace(workspaces.current(), view)
    let filters = parseFilters(DEFAULT_SETTINGS)
    let filtersKey: FiltersKey = filtersKeyOf(DEFAULT_SETTINGS)
    /** Shown in the list and allowed to notify: has a Review Workspace or passes the filters. */
    const isShown = (view: ReviewRequestView) => hasReviewWorkspace(view) || passesFilters(view, filters.filters)
    // The Review Drafts (#29), read by the cards (#10), posting and removal (#30).
    const drafts = createReviewDrafts(orca.storage, deps.clock)
    // Ended Review Requests with a Review Workspace, and removing those workspaces (#28).
    const ended = createEndedWorkspaces({
      ...context,
      storage: orca.storage,
      autoRemoveDays: async () => (await settings()).autoRemoveDays,
      // Unposted Review Comments make manual removal ask and auto-removal skip (#30); once the
      // workspace is gone, by any route, its Review Draft goes too.
      unpostedReviewComments: async (entry) => (await drafts.toPost(entry.url)).length,
      onRemoved: (entry) => drafts.remove(entry.url),
      forgeHost: () => host
    })
    await ended.load()

    async function poll(): Promise<void> {
      const at = deps.clock.now()
      await workspaces.refresh()
      let connection: GitLabConnection | null = null
      host = null
      try {
        const current = await settings()
        connection = await connectionFor(current, orca.secrets)
        host = connection.host
        const all = await gitLab.reviewRequests(connection)
        filters = parseFilters(current)
        const { visible, hidden } = applyFilters(all, filters.filters, hasReviewWorkspace)
        glabHosts = []
        await state.record({ ok: true, at, host: connection.host, reviewRequests: visible, hidden })
      } catch (caught) {
        glabHosts = await otherGlabHosts(caught, connection)
        // A token GitLab or the network echoes back must not reach logs, the panel or the bell.
        const error = redactError(caught, connection?.token)
        log(`poll failed: ${messageOf(error)}`)
        await state.record({ ok: false, at, error })
      }
    }

    /** glab is logged out of this host: which others is it logged in to? ("Use <host>", #8) */
    async function otherGlabHosts(caught: unknown, connection: GitLabConnection | null): Promise<string[]> {
      if (!(caught instanceof GitLabError) || caught.reason !== 'logged-out') return []
      if (connection === null || connection.token !== null) return []
      const loggedIn = await deps.glab.loggedInHosts(connection.glabPath).catch(() => [])
      return loggedIn.filter((other) => other !== connection.host)
    }

    // applySettings() sets the real interval before the first start.
    let intervalMs = DEFAULT_SETTINGS.pollMinutes * MINUTE
    const poller = createPoller({ clock: deps.clock, intervalMs, poll })
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
    const notifier = createNotifier({
      storage: orca.storage,
      show: (note) => orca.host.call('notifications.show', note),
      intervalMs: async () => intervalMsOf(await settings()),
      explainDropped: async (dropped, forHost) => {
        const connection = await currentConnection()
        // Never look an MR up on another host than the one that listed it (#7).
        if (connection.host !== forHost) return new Map()
        return gitLab.explainDropped(connection, dropped)
      },
      isShown,
      isOverdue: (view) => isOverdue(view.requestedAt, deps.clock.now(), overdueHours),
      // The Ended tab (#28) keeps the Ended ones that have a Review Workspace.
      onDropped: (dropped, at) => ended.onDropped(dropped, at),
      log
    })

    // Features hang off the poll state here, one listener each (see poll/poll-state.ts):
    // failure handling (#24) on onFailed with `poller` for backoff, diffing for notifications
    // (#23), Ended (#28) and seen (#10) on onSucceeded, the bell and panel posts (#22) on
    // onChange. onChange listeners run after every onSucceeded/onFailed one, so the bell always
    // draws a fully handled outcome.
    state.onFailed(failures.onFailed)
    state.onSucceeded(failures.onSucceeded)
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
    state.onChange(() => postChanged())

    /** Starts, stops or re-times polling to match the settings. */
    async function applySettings(options: { pollAtOnce?: boolean } = {}): Promise<void> {
      const current = await settings()
      overdueHours = current.overdueHours
      filters = parseFilters(current)
      const filtersChanged = filtersKeyOf(current) !== filtersKey
      filtersKey = filtersKeyOf(current)
      if (!(await isConfigured(orca))) {
        poller.stop()
        connectionKey = null
        return
      }
      intervalMs = intervalMsOf(current)
      poller.setIntervalMs(intervalMs)
      const key = connectionKeyOf(await connectionFor(current, orca.secrets).catch(() => null))
      if (!poller.running) {
        // Needs you stays stopped until the connection changes (or Retry, or a restart).
        if (failures.needsYou() && key === connectionKey) return
        connectionKey = key
        poller.start()
        if (options.pollAtOnce) await poller.pollNow()
      } else if (key !== connectionKey || (filtersChanged && failures.rateLimitedUntil() === null)) {
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
        next.set(url, { unposted: comments.filter((c) => !isPosted(c)).length, toPost: comments.filter(isUnposted).length })
      }
      draftCounts = next
      return viewNow()
    }

    /** Tells open panels the snapshot changed. */
    async function postChanged(): Promise<void> {
      await orca.panels.post('rr.changed', await snapshot())
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
      const workspaceState = workspaces.current()
      const endedCards = ended.entries()
      return withWorkspaces(
        {
          ...base,
          reviewRequests: base.reviewRequests.map((card) => ({ ...card, isNew: seen.isNew(current.host, card.url) })),
          ...(problem === undefined ? {} : { gitlab: problem }),
          ...(filters.invalid.length === 0 ? {} : { invalidFilterEntries: filters.invalid }),
          // The Ended tab, and whether workspace actions are off (#28).
          ...(endedCards.length === 0 ? {} : { ended: endedCards }),
          ...(workspaceState.kind === 'unavailable' ? { workspacesUnavailable: workspaceState.reason } : {})
        },
        workspaceState,
        (url) => draftCounts.get(url) ?? { unposted: 0, toPost: 0 }
      )
    }

    orca.panels.handle('rr.snapshot', async () => snapshot())
    // Also the panel's Retry / Check again; it waits out a rate limit instead of polling.
    orca.panels.handle('rr.refresh', async () => {
      if ((await isConfigured(orca)) && failures.rateLimitedUntil() === null) await poller.pollNow()
      return snapshot()
    })
    // The panel opened (#10): what it lists is seen; the bell drops it from "M new" at once.
    orca.panels.handle('rr.markSeen', async () => {
      const current = state.current()
      if (current.host !== null) await seen.markSeen(current.host, current.reviewRequests)
      await statusBar.render(current)
      return { seen: true as const }
    })
    // Review Workspace actions (#27) and removal (#28).
    const removedWatch = registerWorkspaceRequests(orca, {
      context,
      ended,
      settings,
      reviewRequest: (url) => state.current().reviewRequests.find((rr) => rr.url === url),
      snapshot,
      postChanged,
      files: deps.files,
      gitLab: async () => {
        const connection = await currentConnection()
        return { transport: deps.gitLab(connection), token: connection.token }
      }
    })
    // The Review Draft (#29): import and curation, also for an Ended Review Request whose
    // workspace is still there; posting it (#30). The cards show its counts (#10), so open panels
    // hear of each change.
    const draftCards = (): ReviewRequestCard[] => [
      ...viewNow().reviewRequests,
      ...ended.entries().map((entry) => ({ ...entry, overdue: false }))
    ]
    registerDraftRequests(orca, {
      deps,
      cards: draftCards,
      workspaceState: () => workspaces.current(),
      onChanged: postChanged
    })
    registerPostRequests(orca, {
      drafts,
      cards: draftCards,
      connection: async () => {
        const connection = await currentConnection()
        return { transport: deps.gitLab(connection), token: connection.token }
      },
      onChanged: postChanged
    })
    // Token mode, the Connection section and the setup checklist (#8, #25).
    registerConnectionRequests(orca, {
      deps,
      settings,
      isConfigured: () => isConfigured(orca),
      reconnect: () => applySettings({ pollAtOnce: true }),
      glabHosts: () => glabHosts,
      snapshot
    })

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
      applySettings().catch((error: unknown) => log(`settings: ${String(error)}`))
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

function refreshSummary(state: PollState): string {
  if (state.lastError !== null) return `Couldn't refresh Review Requests: ${messageOf(state.lastError)}`
  const count = state.reviewRequests.length
  return `${count} ${count === 1 ? 'Review Request' : 'Review Requests'}.`
}

const worker = createWorker(realDeps())
export default worker.default
export const deactivate = worker.deactivate
