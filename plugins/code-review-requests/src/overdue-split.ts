// How many Review Requests are not yet overdue and how many are Overdue Review Requests (#53).
// Shared by both sides: the worker's status bar item (to-review.ts) and the panel heading (panel.tsx) count
// with it, from cards the worker marked overdue, so the two always agree.
import type { ReviewRequestCard } from './protocol'

export type OverdueSplit = { inTime: number; overdue: number }

export function overdueSplit(cards: readonly Pick<ReviewRequestCard, 'overdue'>[]): OverdueSplit {
  const overdue = cards.filter((card) => card.overdue).length
  return { inTime: cards.length - overdue, overdue }
}
