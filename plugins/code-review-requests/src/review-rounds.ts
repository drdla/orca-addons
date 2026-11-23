// Review rounds (#79): what the user last did on a merge request, so a re-requested review goes
// back to Todo and says what came before.
//
// GitLab's re-request resets the user's reviewer state to UNREVIEWED (and removes their approval),
// so a re-request shows as a Review Request awaiting the user that the plugin has seen them
// finish before:
//   - approved or requested changes: it ended (the notifier explains the drop) and is listed again;
//   - commented: it stayed listed, and its reviewer state went from REVIEWED back to UNREVIEWED.
// Such a Review Request is re-requested until the user starts reviewing it again (Start review),
// even when its old Review Workspace is still there: the tab follows the round, not the workspace.
//
// The last outcome is kept per MR URL in orca.storage, with or without a Review Workspace, and
// forgotten once the merge request is merged or closed, the user is removed as Reviewer, or it is
// no longer visible to them. A Review Request made draft keeps it. An approved one is off the
// list, so its merge is no drop the notifier sees: `toCheck` hands out the ones to look up again,
// each at most once an hour, and their answers come back through `onDropped`.
import type { Dropped } from './notify/changes'
import type { PreviousOutcome, ReviewRequestView } from './protocol'

export const ROUNDS_KEY = 'review.rounds'

/** How often an unlisted merge request with a last outcome is looked up again. */
const CHECK_EVERY_MS = 60 * 60_000

/** Where the merge request is, to look it up while it isn't listed. */
type Place = Pick<ReviewRequestView, 'url' | 'projectPath' | 'iid' | 'title' | 'author' | 'requestedAt'>

type Round = { outcome: PreviousOutcome; reRequested: boolean; mergeRequest: Place }

function placeOf(r: ReviewRequestView): Place {
  return { url: r.url, projectPath: r.projectPath, iid: r.iid, title: r.title, author: r.author, requestedAt: r.requestedAt }
}

type Storage = { get(key: string): Promise<unknown>; set(key: string, value: never): Promise<void> }

export type ReviewRounds = ReturnType<typeof createReviewRounds>

export function createReviewRounds(storage: Storage) {
  let rounds: Record<string, Round> = {}
  /** When each unlisted merge request was last handed out by toCheck (ms); not stored. */
  const checkedAt = new Map<string, number>()

  async function save(next: Record<string, Round>): Promise<void> {
    rounds = next
    await storage.set(ROUNDS_KEY, next as never)
  }

  return {
    /** Reads the stored rounds; call once before anything else. */
    async load(): Promise<void> {
      const stored = await storage.get(ROUNDS_KEY)
      rounds = stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, Round>) : {}
    },

    /**
     * A good poll's whole list. Records a comment-only review, and marks re-requested what awaits
     * the user after an outcome. Answers the URLs re-requested by this poll, for the notifications.
     */
    async onListed(reviewRequests: ReviewRequestView[]): Promise<Set<string>> {
      const next = { ...rounds }
      const reRequested = new Set<string>()
      for (const r of reviewRequests) {
        const round = next[r.url]
        if (r.myReview === 'commented') {
          if (round?.outcome !== 'commented' || round.reRequested) {
            next[r.url] = { outcome: 'commented', reRequested: false, mergeRequest: placeOf(r) }
          }
        } else if (round !== undefined && !round.reRequested && r.awaitingReview === true) {
          next[r.url] = { ...round, reRequested: true }
          reRequested.add(r.url)
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(rounds)) await save(next)
      return reRequested
    },

    /**
     * The merge requests with a last outcome that aren't on this good poll's list and weren't
     * looked up in the last hour: ask GitLab why (explainDropped) and hand the answers to onDropped.
     */
    toCheck(reviewRequests: ReviewRequestView[], now: number): ReviewRequestView[] {
      const listed = new Set(reviewRequests.map((r) => r.url))
      const due: ReviewRequestView[] = []
      for (const round of Object.values(rounds)) {
        const { url } = round.mergeRequest
        if (listed.has(url) || now - (checkedAt.get(url) ?? -Infinity) < CHECK_EVERY_MS) continue
        checkedAt.set(url, now)
        due.push(round.mergeRequest)
      }
      return due
    },

    /**
     * Explained drops (the notifier's, and toCheck's lookups): an approval or a request for changes
     * is recorded, a merge request that is over forgotten.
     */
    async onDropped(dropped: Dropped[]): Promise<void> {
      const next = { ...rounds }
      for (const d of dropped) {
        if (d.reason === 'approved' || d.reason === 'changes-requested') {
          next[d.url] = { outcome: d.reason, reRequested: false, mergeRequest: placeOf(d) }
        } else if (d.reason !== 'draft') {
          delete next[d.url]
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(rounds)) await save(next)
    },

    /** Re-requested and not started again: what the user did last round, or null. */
    reRequested(url: string): PreviousOutcome | null {
      const round = rounds[url]
      return round?.reRequested ? round.outcome : null
    },

    /**
     * Start review on a re-requested Review Request: the new round has begun, and the last one's
     * outcome is forgotten. Kept, it would mark the review re-requested again, as it still awaits
     * the user; this round's outcome is recorded when it comes.
     */
    async started(url: string): Promise<void> {
      if (rounds[url]?.reRequested) {
        const { [url]: _done, ...rest } = rounds
        await save(rest)
      }
    }
  }
}
