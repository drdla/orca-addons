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
import type { ReviewRequestsSnapshot, ReviewRequestView } from './protocol'
import type { GitLabConnection, GitLabTransport } from './seams/gitlab'
import { DEFAULT_SETTINGS, readSettings, type Settings } from './settings'
import { createStatusBar } from './status-bar'
import { applyFilters, parseFilters, passesFilters } from './filters'
import { createRequestedAtCache } from './gitlab/requested-at'
import { overdueRefiner, type OverdueContext } from './to-review'

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
    // Filters (#26). `hasReviewWorkspace` is the "never hide one with a Review Workspace" rule:
    // #27 replaces this no-op with a lookup of the workspaces it finds per poll.
    const hasReviewWorkspace = (_view: ReviewRequestView): boolean => false
    let filters = parseFilters(DEFAULT_SETTINGS)
    let filtersKey = ''
    /** Shown in the list and allowed to notify: has a Review Workspace or passes the filters. */
    const isShown = (view: ReviewRequestView) => hasReviewWorkspace(view) || passesFilters(view, filters.filters)
    /** The host the last poll tried, or null if the instance URL is no URL. */
    let host: string | null = null

    async function poll(): Promise<void> {
      const at = deps.clock.now()
      let token: string | null = null
      try {
        const settings = await readSettings(orca.settings)
        host = null
        const connection = await connectionFor(settings, orca.secrets)
        host = connection.host
        token = connection.token
        const all = await gitLab.reviewRequests(connection)
        filters = parseFilters(settings)
        const { visible, hidden } = applyFilters(all, filters.filters, hasReviewWorkspace)
        await state.record({ ok: true, at, reviewRequests: visible, hidden })
      } catch (caught) {
        // A token GitLab or the network echoes back must not reach logs, the panel or the bell.
        const error = redactError(caught, token)
        orca.log(`poll failed: ${error instanceof Error ? error.message : String(error)}`)
        await state.record({ ok: false, at, error })
      }
    }

    // applySettings() sets the real interval before the first start.
    let intervalMs = 5 * MINUTE
    const poller: Poller = createPoller({ clock: deps.clock, intervalMs, poll })
    const failures = createFailureHandling({
      clock: deps.clock,
      poller,
      intervalMs: () => intervalMs,
      host: () => host,
      storage: orca.storage,
      notify: (notification) => orca.host.call('notifications.show', notification)
    })
    // The problem states replace the whole look, so they come last.
    const statusBar = createStatusBar(orca, [overdueRefiner(overdue), failures.refineStatusBar])

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
      explainDropped: async (dropped) =>
        gitLab.explainDropped(await connectionFor(await readSettings(orca.settings), orca.secrets), dropped),
      isShown,
      log: (message) => orca.log(message)
    })
    // The notifier diffs the whole list (shown and hidden), so changing a filter never looks like
    // a new or an Ended Review Request; isShown keeps hidden ones out of the notifications.
    state.onSucceeded((_previous, next) =>
      notifier.onGoodPoll([...next.reviewRequests, ...next.hidden], next.lastSuccessAt!)
    )
    state.onChange((current) => statusBar.render(current))
    state.onChange(() => orca.panels.post('rr.changed', snapshot()))

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

    /** The panel's view: the poll state plus, while GitLab fails, the problem (#24). */
    function snapshot(): ReviewRequestsSnapshot {
      const current = state.current()
      const problem = failures.problemView(current)
      return {
        ...snapshotOf(current, overdue),
        ...(problem === undefined ? {} : { gitlab: problem }),
        ...(filters.invalid.length === 0 ? {} : { invalidFilterEntries: filters.invalid })
      }
    }

    orca.panels.handle('rr.snapshot', async () => snapshot())
    // Also the panel's Retry / Check again; it waits out a rate limit instead of polling.
    orca.panels.handle('rr.refresh', async () => {
      if ((await isConfigured(orca)) && failures.rateLimitedUntil() === null) await poller.pollNow()
      return snapshot()
    })
    orca.panels.handle('rr.copyLink', async ({ url }) => {
      await deps.desktop.copyText(url)
      return { copied: true as const }
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
  return connection === null ? '' : `${connection.host}\n${connection.token ?? ''}`
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
