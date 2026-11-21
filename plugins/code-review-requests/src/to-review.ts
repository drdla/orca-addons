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

/**
 * Splits the bell into "in time | overdue" while any Review Request is overdue (#10): "2 |" in
 * the bell, "3" in red beside it. Only overdue: just the red count in the bell, no "0 |".
 */
export function overdueRefiner(context: OverdueContext): StatusBarRefiner {
  return (look, state) => {
    const overdue = cardsOf(state, context).filter((card) => card.overdue).length
    if (overdue === 0) return look
    const inTime = state.reviewRequests.length - overdue
    const tooltip = look.tooltip.replace(/\. Click to open\.$/, `, ${overdue} overdue. Click to open.`)
    if (inTime === 0) return { ...look, tone: 'danger', tooltip }
    return { ...look, text: `${inTime} |`, tooltip, overdue }
  }
}
