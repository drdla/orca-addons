// What the worker derives for the To review tab (#22): the cards in order, longest waiting
// first, each marked overdue or not, and the bell's overdue look. Overdue depends on the time, so
// it is derived when asked, never stored in the poll state.
import { isOverdue } from './overdue'
import type { PollState } from './poll/poll-state'
import type { ReviewRequestCard } from './protocol'
import type { StatusBarRefiner } from './status-bar'

/** What overdue is measured against: the clock and the "Overdue after" setting. */
export type OverdueContext = { now(): number; overdueHours(): number }

export function cardsOf(state: PollState, context: OverdueContext): ReviewRequestCard[] {
  const now = context.now()
  const hours = context.overdueHours()
  return state.reviewRequests
    .map((view) => ({ ...view, overdue: isOverdue(view.requestedAt, now, hours) }))
    .sort((a, b) => a.requestedAt - b.requestedAt)
}

/** Danger tone and "N overdue" in the tooltip while any Review Request is overdue (#10). */
export function overdueRefiner(context: OverdueContext): StatusBarRefiner {
  return (look, state) => {
    const overdue = cardsOf(state, context).filter((card) => card.overdue).length
    if (overdue === 0) return look
    return {
      ...look,
      tone: 'danger',
      tooltip: look.tooltip.replace(/\. Click to open\.$/, `, ${overdue} overdue. Click to open.`)
    }
  }
}
