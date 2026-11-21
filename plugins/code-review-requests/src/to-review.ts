// What the worker derives for the To review tab (#22): the cards in order, longest waiting
// first, each marked overdue or not, and the status bar item's overdue look. Overdue depends on the time, so
// it is derived when asked, never stored in the poll state.
import { isOverdue } from './overdue'
import { overdueSplit } from './overdue-split'
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
 * "in time | overdue!" in the status bar item while any Review Request is overdue (#10): "2 | 3!". Only
 * overdue shows just that count ("2!", never "0 | 2!"). The "!" marks the overdue count instead of
 * colour: a status bar item has one tone, so the overdue part can't be red on its own.
 */
export function overdueRefiner(context: OverdueContext): StatusBarRefiner {
  return (look, state) => {
    const { inTime, overdue } = overdueSplit(cardsOf(state, context))
    if (overdue === 0) return look
    return {
      ...look,
      text: inTime === 0 ? `${overdue}!` : `${inTime} | ${overdue}!`,
      tooltip: look.tooltip.replace(/\. Click to open\.$/, `, ${overdue} overdue. Click to open.`)
    }
  }
}
