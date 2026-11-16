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
import { createPollState, snapshotOf, type PollState } from './poll/poll-state'
import { createPoller, type Poller } from './poll/poller'
import { explainDropped } from './notify/explain-dropped'
import { createNotifier } from './notify/notifier'
import type { ReviewRequestView } from './protocol'
import type { GitLabConnection, GitLabTransport } from './seams/gitlab'
import { readSettings, type Settings } from './settings'
import { createStatusBar } from './status-bar'

export const REFRESH_COMMAND = 'code-review-requests.refresh'

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
    const statusBar = createStatusBar(orca)
    const gitLab = createGitLabSource(deps)
    let connectionKey: string | null = null

    async function poll(): Promise<void> {
      const at = deps.clock.now()
      try {
        const settings = await readSettings(orca.settings)
        const reviewRequests = await gitLab.reviewRequests(await connectionFor(settings))
        await state.record({ ok: true, at, reviewRequests })
      } catch (error) {
        orca.log(`poll failed: ${error instanceof Error ? error.message : String(error)}`)
        await state.record({ ok: false, at, error })
      }
    }

    // applySettings() sets the real interval before the first start.
    const poller: Poller = createPoller({ clock: deps.clock, intervalMs: 5 * MINUTE, poll })

    // Features hang off the poll state here, one listener each (see poll/poll-state.ts):
    // diffing for notifications (#23) on onSucceeded, failure handling (#24) on onFailed with
    // `poller` for backoff, panel posts (#22) on onChange. onChange listeners run after every
    // onSucceeded/onFailed one, so the bell always draws a fully handled outcome.
    const notifier = createNotifier({
      storage: orca.storage,
      show: (note) => orca.host.call('notifications.show', note),
      intervalMs: async () => intervalMsOf(await readSettings(orca.settings)),
      explainDropped: async (dropped) =>
        gitLab.explainDropped(await connectionFor(await readSettings(orca.settings)), dropped),
      log: (message) => orca.log(message)
    })
    state.onSucceeded((_previous, next) => notifier.onGoodPoll(next.reviewRequests, next.lastSuccessAt!))
    state.onChange((current) => statusBar.render(current))

    /** Starts, stops or re-times polling to match the settings. */
    async function applySettings(): Promise<void> {
      if (!(await isConfigured(orca))) {
        poller.stop()
        connectionKey = null
        return
      }
      const settings = await readSettings(orca.settings)
      poller.setIntervalMs(intervalMsOf(settings))
      const key = keyOf(await connectionFor(settings).catch(() => null))
      if (!poller.running) {
        connectionKey = key
        poller.start()
      } else if (key !== connectionKey) {
        connectionKey = key
        await poller.pollNow()
      }
    }

    orca.panels.handle('rr.snapshot', async () => snapshotOf(state.current()))
    orca.commands.register(REFRESH_COMMAND, async () => {
      if (!(await isConfigured(orca))) return 'GitLab is not set up yet.'
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
      return fetchReviewRequests(transport, me)
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
