// The bell in Orca's status bar (#10): the Review Request count, hidden at 0.
//
// The look is computed from the poll state by statusBarLook(), then passed through `refiners`
// in order, so later slices change it without editing this file's base rule: the overdue split
// (#22) and the "GitLab: set up" / "GitLab: offline" problem states (#24) are each one refiner.
import type { OrcaWorkerApi } from 'orca/worker'
import type { PollState } from './poll/poll-state'

export const STATUS_BAR_ID = 'review-requests'

export type StatusBarLook = {
  text: string
  icon: 'bell' | 'plug' | 'warning'
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  tooltip: string
  visible: boolean
}

export type StatusBarRefiner = (look: StatusBarLook, state: PollState) => StatusBarLook

export function statusBarLook(state: PollState): StatusBarLook {
  const count = state.reviewRequests.length
  return {
    text: String(count),
    icon: 'bell',
    tone: 'neutral',
    tooltip: `${count} ${count === 1 ? 'Review Request' : 'Review Requests'}. Click to open.`,
    visible: count > 0
  }
}

/** Draws the look for each state it is given, skipping the host call when nothing changed. */
export function createStatusBar(
  orca: Pick<OrcaWorkerApi, 'host'>,
  refiners: readonly StatusBarRefiner[] = []
) {
  let drawn: string | null = null
  return {
    async render(state: PollState): Promise<void> {
      const look = refiners.reduce((current, refine) => refine(current, state), statusBarLook(state))
      const key = JSON.stringify(look)
      if (key === drawn) return
      await orca.host.call('statusBar.update', { id: STATUS_BAR_ID, ...look })
      drawn = key
    }
  }
}
