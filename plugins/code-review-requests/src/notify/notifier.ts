// Turns good polls into notifications (#23). It keeps a baseline (the last list it notified about
// and when that poll ran) in orca.storage, so a restarted worker knows what the user has already
// heard of and how long it was away.
//   - No baseline yet: first run, one summary of what is waiting.
//   - Catch-up (see isCatchUp): one summary of what changed since the baseline.
//   - Otherwise: one notification per new and per dropped Review Request.
// Items that came and went while away are never on either list, so they are never notified.
// Only good polls reach the notifier, so a failed poll never derives new or dropped items.
import type { ReviewRequestView } from '../protocol'
import { diffReviewRequests, isCatchUp, type DropReason, type Dropped } from './changes'
import { catchUpNote, droppedNote, firstRunNote, newNote, type Note } from './notes'

export const BASELINE_KEY = 'notify.baseline'

export type Baseline = { reviewRequests: ReviewRequestView[]; lastSuccessAt: number }

type Storage = {
  get(key: string): Promise<unknown>
  set(key: string, value: never): Promise<void>
}

export type NotifierOptions = {
  storage: Storage
  show(note: Note): Promise<unknown>
  /** The polling interval now; catch-up is a gap of more than twice this. */
  intervalMs(): number | Promise<number>
  /**
   * Asks GitLab why each Review Request dropped off. Items missing from the answer (lookup
   * failed) stay in the baseline and are asked about again on the next poll.
   */
  explainDropped(dropped: ReviewRequestView[]): Promise<Map<string, DropReason>>
  /**
   * Whether a Review Request may notify (#26: not hidden by the filters). Hand the notifier the
   * whole list, hidden ones included: one that only became hidden or shown has not come or gone,
   * so it is never notified as new or ended, and a hidden one that drops off is never looked up.
   */
  isShown?(view: ReviewRequestView): boolean
  /**
   * Every dropped Review Request once its reason is known, with the poll's time (made draft
   * included; see isEnded). The Ended tab (#28) keeps the Ended ones.
   */
  onDropped?(dropped: Dropped[], at: number): void | Promise<void>
  log?(message: string): void
}

/** The stored baseline, or null on first run (or if what is stored is unreadable). */
export async function loadBaseline(storage: Pick<Storage, 'get'>): Promise<Baseline | null> {
  const value = (await storage.get(BASELINE_KEY)) as Partial<Baseline> | null
  if (value === null || typeof value !== 'object') return null
  if (!Array.isArray(value.reviewRequests) || typeof value.lastSuccessAt !== 'number') return null
  return { reviewRequests: value.reviewRequests, lastSuccessAt: value.lastSuccessAt }
}

export function createNotifier(options: NotifierOptions) {
  const log = options.log ?? (() => {})
  const isShown = options.isShown ?? (() => true)
  let baseline: Baseline | null | undefined
  let sawGoodPoll = false

  async function send(notes: (Note | null)[]): Promise<void> {
    for (const note of notes) {
      if (note === null) continue
      await options.show(note).catch((error: unknown) => log(`notification failed: ${String(error)}`))
    }
  }

  return {
    /** Hand it every good poll: its list and when it started. */
    async onGoodPoll(reviewRequests: ReviewRequestView[], at: number): Promise<void> {
      if (baseline === undefined) baseline = await loadBaseline(options.storage)
      const firstSinceStart = !sawGoodPoll
      sawGoodPoll = true

      if (baseline === null) {
        await save({ reviewRequests, lastSuccessAt: at })
        await send([firstRunNote(reviewRequests.filter(isShown))])
        return
      }

      const changes = diffReviewRequests(baseline.reviewRequests, reviewRequests)
      const added = changes.added.filter(isShown)
      const dropped = changes.dropped.filter(isShown)
      const reasons = dropped.length > 0 ? await options.explainDropped(dropped) : new Map()
      const explained: Dropped[] = []
      const unexplained: ReviewRequestView[] = []
      for (const r of dropped) {
        const reason = reasons.get(r.url)
        if (reason === undefined) unexplained.push(r)
        else explained.push({ ...r, reason })
      }
      const catchUp = isCatchUp({
        firstSinceStart,
        lastSuccessAt: baseline.lastSuccessAt,
        at,
        intervalMs: await options.intervalMs()
      })
      await save({ reviewRequests: [...reviewRequests, ...unexplained], lastSuccessAt: at })
      if (explained.length > 0) await options.onDropped?.(explained, at)
      await send(catchUp ? [catchUpNote(added, explained)] : [...added.map(newNote), ...explained.map(droppedNote)])
    }
  }

  async function save(next: Baseline): Promise<void> {
    baseline = next
    await options.storage.set(BASELINE_KEY, next as never)
  }
}
