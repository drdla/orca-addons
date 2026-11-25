// How many Review Requests are not yet overdue and how many are Overdue Review Requests (#53).
// Shared by both sides: the worker's status bar item (to-review.ts) and the panel heading (panel.tsx) count
// with it, from cards the worker marked overdue, so the two always agree.
import type { ReviewRequestCard } from './protocol'

export type OverdueSplit = { inTime: number; overdue: number }

/**
 * A count as the status bar item writes it, also used for the tab labels: "5" while none is
 * overdue, "2 + 3!" (in time + overdue) once any is, and just "3!" when all are. The "!" marks the
 * overdue count, since neither place can colour part of its text.
 */
export function countText({ inTime, overdue }: OverdueSplit): string {
  if (overdue === 0) return String(inTime)
  return inTime === 0 ? `${overdue}!` : `${inTime} + ${overdue}!`
}

export function overdueSplit(cards: readonly Pick<ReviewRequestCard, 'overdue'>[]): OverdueSplit {
  const overdue = cards.filter((card) => card.overdue).length
  return { inTime: cards.length - overdue, overdue }
}
