// What a failed poll means and how polling recovers (#15, #24). Two classes:
//   - Needs you (glab missing or logged out, token 401, GitLab older than 17.4, a bad instance
//     URL): polling stops, the status bar says "GitLab: set up", and one notification goes out
//     on the transition from working. It recovers through Retry (rr.retry / the refresh command),
//     a new connection (instance URL, token) or a worker restart.
//   - Transient (network, 5xx, 429, and anything unexpected): retried after 1, 2, 4… minutes,
//     capped at the poll interval, or when Retry-After says. The status bar says
//     "GitLab: offline" only once the last good poll is older than 2× the interval.
// A failed poll keeps the last good list and never reaches onSucceeded (poll-state.ts), so it
// never derives new or Ended Review Requests, and lastSuccessAt only moves on success: the first
// good poll after an outage sees `previous.lastSuccessAt` from before the gap (#23's catch-up).
//
// It hangs off the poll state's onFailed/onSucceeded listeners, steers the poller, refines the
// status bar and adds `gitlab` to the snapshot; the worker wires it up (src/worker.ts).
import type { GitLabProblemView, SetupReason } from '../protocol'
import type { Clock } from '../seams/clock'
import { GitLabError } from '../seams/gitlab'
import type { StatusBarRefiner } from '../status-bar'
import type { PollState } from './poll-state'
import type { Poller } from './poller'
import { messageOf } from '../errors'

const MINUTE = 60_000

/** Remembers across restarts whether the user already heard that GitLab broke. */
export const HEALTH_STORAGE_KEY = 'gitlab.health'

type NeedsYou = Extract<GitLabProblemView, { status: 'needs-you' }>

export type FailureHandlingOptions = {
  clock: Clock
  poller: Pick<Poller, 'retryAt' | 'start' | 'stop' | 'running' | 'nextDueAt'>
  /** The current poll interval. */
  intervalMs: () => number
  /** The host of the connection the last poll used, or null if the URL was no URL. */
  host: () => string | null
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: 'ok' | 'needs-you'): Promise<void>
  }
  notify: (notification: { title: string; body: string }) => Promise<unknown>
}

export function createFailureHandling(options: FailureHandlingOptions) {
  const { clock, poller } = options
  let transientStreak = 0
  /** When the current run of failures began; null while polls work. */
  let failingSince: number | null = null
  let rateLimitedUntil: number | null = null
  let needsYou: NeedsYou | null = null
  let stored: unknown

  async function remember(health: 'ok' | 'needs-you'): Promise<unknown> {
    stored ??= await options.storage.get(HEALTH_STORAGE_KEY)
    const before = stored
    if (before !== health) {
      stored = health
      await options.storage.set(HEALTH_STORAGE_KEY, health)
    }
    return before
  }

  function isOffline(state: PollState): boolean {
    if (needsYou !== null || state.lastError === null || failingSince === null) return false
    return clock.now() - (state.lastSuccessAt ?? failingSince) > 2 * options.intervalMs()
  }

  return {
    /** An onFailed listener. */
    async onFailed(error: unknown, state: PollState): Promise<void> {
      failingSince ??= state.lastAttemptAt ?? clock.now()
      if (error instanceof GitLabError && error.kind === 'needs-you') {
        rateLimitedUntil = null
        needsYou = needsYouView(error, options.host())
        poller.stop()
        // Only on the transition from working; never on a first run (the status bar covers it).
        if ((await remember('needs-you')) === 'ok') {
          await options.notify({
            title: 'GitLab Review Requests need you',
            body: `${summaryOf(needsYou)}. Click the status bar to fix it.`
          })
        }
        return
      }
      transientStreak++
      const backoff = Math.min(MINUTE * 2 ** (transientStreak - 1), options.intervalMs())
      const retryAfterMs = error instanceof GitLabError ? error.retryAfterMs : undefined
      const retryAt = clock.now() + (retryAfterMs ?? backoff)
      rateLimitedUntil = error instanceof GitLabError && error.status === 429 && retryAfterMs !== undefined ? retryAt : null
      // While stopped for Needs you, a Retry that fails transiently keeps it stopped.
      if (poller.running) poller.retryAt(retryAt)
    },

    /** An onSucceeded listener. */
    async onSucceeded(_previous: PollState | null, next: PollState): Promise<void> {
      transientStreak = 0
      failingSince = null
      rateLimitedUntil = null
      if (needsYou !== null) {
        needsYou = null
        if (!poller.running) {
          poller.start()
          poller.retryAt((next.lastSuccessAt ?? clock.now()) + options.intervalMs())
        }
      }
      await remember('ok')
    },

    /** True while polling is stopped until the user fixes the setup. */
    needsYou(): boolean {
      return needsYou !== null
    },

    /** While GitLab asked to wait (a 429 with Retry-After), until when; a manual Refresh waits too. */
    rateLimitedUntil(): number | null {
      return rateLimitedUntil !== null && rateLimitedUntil > clock.now() ? rateLimitedUntil : null
    },

    /** What the panel shows about the failure, or undefined while polling works. */
    problemView(state: PollState): GitLabProblemView | undefined {
      if (needsYou !== null) return needsYou
      if (state.lastError === null) return undefined
      const limitedUntil = rateLimitedUntil !== null && rateLimitedUntil > clock.now() ? rateLimitedUntil : null
      return {
        status: 'retrying',
        message: messageOf(state.lastError),
        lastSuccessAt: state.lastSuccessAt,
        retryAt: poller.nextDueAt,
        rateLimitedUntil: limitedUntil === null ? null : clockTime(limitedUntil),
        offline: isOffline(state)
      }
    },

    /** "GitLab: set up" / "GitLab: offline" in place of the status bar item. */
    refineStatusBar: ((look, state) => {
      if (needsYou !== null) {
        return {
          text: 'GitLab: set up',
          icon: 'plug',
          tone: 'warning',
          tooltip: `GitLab needs setting up: ${summaryOf(needsYou)}. Click to open.`,
          visible: true
        }
      }
      if (isOffline(state)) {
        return {
          text: 'GitLab: offline',
          icon: 'warning',
          tone: 'warning',
          tooltip: `Can't reach GitLab: ${messageOf(state.lastError)}. Retrying. Click to open.`,
          visible: true
        }
      }
      return look
    }) satisfies StatusBarRefiner
  }
}

function needsYouView(error: GitLabError, host: string | null): NeedsYou {
  const reason: SetupReason = error.reason ?? 'logged-out'
  const version = reason === 'gitlab-too-old' ? (/runs (\S+?)\.?$/.exec(error.message)?.[1] ?? null) : null
  return { status: 'needs-you', reason, host, version, message: error.message }
}

/** One clause about what's wrong, for the status-bar tooltip and the notification body. */
function summaryOf(problem: NeedsYou): string {
  const host = problem.host ?? 'GitLab'
  switch (problem.reason) {
    case 'glab-missing':
      return 'glab is not installed'
    case 'logged-out':
      return `glab is not logged in to ${host}`
    case 'token-rejected':
      return `Your token for ${host} was rejected (expired or revoked)`
    case 'gitlab-too-old':
      return `${host} runs GitLab ${problem.version ?? 'older than 17.4'}, and Review Requests need 17.4 or later`
    case 'bad-url':
      return 'The GitLab instance URL is not valid'
  }
}

/** `HH:MM` in the worker's local time zone, as in "Rate-limited until 14:05". */
export function clockTime(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
