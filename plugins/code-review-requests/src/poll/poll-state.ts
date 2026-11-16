// What the worker knows from polling GitLab, and the extension points every feature hangs off.
//
// Each poll ends in exactly one PollOutcome, which the worker hands to record(). Features plug in
// as listeners instead of editing the poll loop:
//   - onSucceeded(previous, next): diff two good lists (new and Ended Review Requests, #23).
//   - onFailed(error, state): classify a failure, back off or stop (#24).
//   - onChange(state): redraw anything derived from the state (status bar, panel posts, #22).
// A failed poll keeps the last good list (#15): only lastAttemptAt and lastError move.
import type { ReviewRequestView, ReviewRequestsSnapshot } from '../protocol'
import type { Disposable } from '../seams/clock'
import { cardsOf, type OverdueContext } from '../to-review'

export type PollOutcome =
  | { ok: true; at: number; host: string; reviewRequests: ReviewRequestView[]; hidden?: ReviewRequestView[] }
  | { ok: false; at: number; error: unknown }

export type PollState = {
  /** The GitLab host the last good list came from, or null before the first one. */
  host: string | null
  /** The last good list; empty until the first poll succeeds. */
  reviewRequests: ReviewRequestView[]
  /** The rest of the last good list: what the filters hide (#26). Not counted or shown anywhere. */
  hidden: ReviewRequestView[]
  /** When the last poll that succeeded started, or null if none has. */
  lastSuccessAt: number | null
  /** When the last poll started, whatever its outcome. */
  lastAttemptAt: number | null
  /** Why the last poll failed, or null if it succeeded (or none ran yet). */
  lastError: unknown
}

export type Listener<A extends unknown[]> = (...args: A) => void | Promise<void>

export type PollStateStore = {
  current(): PollState
  /** Records one poll's outcome, then awaits the listeners in the order they were added. */
  record(outcome: PollOutcome): Promise<void>
  /** A poll succeeded. `previous` is null on the first success since the worker started. */
  onSucceeded(listener: Listener<[previous: PollState | null, next: PollState]>): Disposable
  onFailed(listener: Listener<[error: unknown, state: PollState]>): Disposable
  /** After every outcome, once the onSucceeded/onFailed listeners have run. */
  onChange(listener: Listener<[state: PollState]>): Disposable
}

export const INITIAL_POLL_STATE: PollState = {
  host: null,
  reviewRequests: [],
  hidden: [],
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastError: null
}

/** `log` hears listeners that throw; one broken feature must not stop the others. */
export function createPollState(log: (message: string) => void = () => {}): PollStateStore {
  let state = INITIAL_POLL_STATE
  const succeeded = new Set<Listener<[PollState | null, PollState]>>()
  const failed = new Set<Listener<[unknown, PollState]>>()
  const changed = new Set<Listener<[PollState]>>()

  async function notify<A extends unknown[]>(listeners: Set<Listener<A>>, ...args: A) {
    for (const listener of [...listeners]) {
      try {
        await listener(...args)
      } catch (error) {
        log(`poll listener failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  function add<T>(set: Set<T>, listener: T): Disposable {
    set.add(listener)
    return { dispose: () => void set.delete(listener) }
  }

  return {
    current: () => state,
    async record(outcome) {
      if (outcome.ok) {
        const previous = state.lastSuccessAt === null ? null : state
        state = {
          host: outcome.host,
          reviewRequests: outcome.reviewRequests,
          hidden: outcome.hidden ?? [],
          lastSuccessAt: outcome.at,
          lastAttemptAt: outcome.at,
          lastError: null
        }
        await notify(succeeded, previous, state)
      } else {
        state = { ...state, lastAttemptAt: outcome.at, lastError: outcome.error }
        await notify(failed, outcome.error, state)
      }
      await notify(changed, state)
    },
    onSucceeded: (listener) => add(succeeded, listener),
    onFailed: (listener) => add(failed, listener),
    onChange: (listener) => add(changed, listener)
  }
}

/** What the panel gets from rr.snapshot and rr.changed. Extend it with ReviewRequestsSnapshot. */
export function snapshotOf(state: PollState, overdue: OverdueContext): ReviewRequestsSnapshot {
  const snapshot: ReviewRequestsSnapshot = { reviewRequests: cardsOf(state, overdue), refreshedAt: state.lastSuccessAt }
  if (state.hidden.length > 0) snapshot.hiddenByFilters = state.hidden.length
  return snapshot
}
