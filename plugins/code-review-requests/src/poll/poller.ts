// The poll schedule, on a wall-clock tick. Node timers pause while the Mac sleeps and there is no
// wake event (#2), so instead of one long timer per interval the poller wakes every `tickMs`,
// compares the clock with the next due time, and polls when it has passed. After a sleep the
// first tick polls at once.
//
// The poller only decides *when*. What a poll does, and what happens with its outcome, is the
// `poll` callback's business (see poll-state.ts). Failure handling (#24) steers the schedule with
// retryAt() for backoff and stop() for "Needs you".
import type { Clock, Disposable } from '../seams/clock'

export const TICK_MS = 30_000

export type Poller = {
  /** Starts ticking; the first poll runs on the next turn of the clock. No-op if running. */
  start(): void
  /** Stops ticking. A poll in flight still finishes. */
  stop(): void
  readonly running: boolean
  /** Polls now, unless a poll is in flight, in which case it waits for that one. */
  pollNow(): Promise<void>
  /** Sets the interval; the next poll is due `ms` after the last one started. */
  setIntervalMs(ms: number): void
  /** The next poll is due at `at` instead of after the interval (backoff, Retry-After). */
  retryAt(at: number): void
  /** When the next scheduled poll is due, or null while stopped. */
  readonly nextDueAt: number | null
}

export function createPoller(options: {
  clock: Clock
  intervalMs: number
  /** Must not reject; a rejection is swallowed so the worker survives. */
  poll: () => Promise<void>
  tickMs?: number
}): Poller {
  const { clock, poll } = options
  const tickMs = options.tickMs ?? TICK_MS
  let intervalMs = options.intervalMs
  let timers: Disposable[] = []
  let lastStartedAt: number | null = null
  let nextDueAt: number | null = null
  let inFlight: Promise<void> | null = null

  function run(): Promise<void> {
    if (inFlight) return inFlight
    lastStartedAt = clock.now()
    if (nextDueAt !== null) nextDueAt = lastStartedAt + intervalMs
    inFlight = (async () => {
      try {
        await poll()
      } catch {
        // poll reports its own failures; this only keeps the worker alive.
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  async function tick(): Promise<void> {
    if (nextDueAt !== null && clock.now() >= nextDueAt) await run()
  }

  const poller: Poller = {
    start() {
      if (timers.length > 0) return
      nextDueAt = clock.now()
      timers = [clock.after(0, tick), clock.every(tickMs, tick)]
    },
    stop() {
      for (const timer of timers) timer.dispose()
      timers = []
      nextDueAt = null
    },
    get running() {
      return timers.length > 0
    },
    pollNow: run,
    setIntervalMs(ms) {
      intervalMs = ms
      if (nextDueAt !== null && lastStartedAt !== null) nextDueAt = lastStartedAt + ms
    },
    retryAt(at) {
      if (nextDueAt !== null) nextDueAt = at
    },
    get nextDueAt() {
      return nextDueAt
    }
  }
  return poller
}
