// What changed between two good lists of Review Requests, and whether a poll is a catch-up. Pure,
// so failure handling (#24) and the panel can reuse the same rules the notifications follow.
import type { ReviewRequestView } from '../protocol'

/**
 * Why a Review Request dropped off the list. 'draft' and 'not-visible' (GitLab no longer shows
 * the MR to the user: deleted or access lost, so whether it ended is unknown) are not Ended
 * Review Requests.
 */
export type DropReason =
  | 'approved'
  | 'changes-requested'
  | 'merged'
  | 'closed'
  | 'unassigned'
  | 'not-visible'
  | 'draft'

export type Dropped = ReviewRequestView & { reason: DropReason }

export type Changes = {
  /** On the new list, not on the old one. */
  added: ReviewRequestView[]
  /** On the old list, not on the new one; the reason is still unknown. */
  dropped: ReviewRequestView[]
}

/** Compares two good lists by URL, the Review Request's identity. Keeps each list's order. */
export function diffReviewRequests(before: ReviewRequestView[], after: ReviewRequestView[]): Changes {
  const was = new Set(before.map((r) => r.url))
  const is = new Set(after.map((r) => r.url))
  return {
    added: after.filter((r) => !was.has(r.url)),
    dropped: before.filter((r) => !is.has(r.url))
  }
}

/**
 * A poll is a catch-up when it is the first good poll since the worker started, or when the last
 * good poll is more than 2x the interval old (sleep, offline, a long run of failures).
 */
export function isCatchUp(input: {
  firstSinceStart: boolean
  lastSuccessAt: number
  at: number
  intervalMs: number
}): boolean {
  return input.firstSinceStart || input.at - input.lastSuccessAt > 2 * input.intervalMs
}

export function isEnded(dropped: Dropped): boolean {
  return dropped.reason !== 'draft' && dropped.reason !== 'not-visible'
}
