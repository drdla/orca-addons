// The bell in Orca's status bar (#10): the Review Request count, hidden at 0.
//
// The look is computed from the poll state by statusBarLook(), then passed through `refiners`
// in order, so later slices change it without editing this file's base rule: the overdue split
// (#22) and the "GitLab: set up" / "GitLab: offline" problem states (#24) are each one refiner.
//
// A status bar item has one text and one tone, so the overdue count ("2 | 3", the 3 in red) is a
// second item, OVERDUE_STATUS_BAR_ID, drawn right after the bell from the look's `overdue`.
import type { OrcaWorkerApi } from 'orca/worker'
import type { PollState } from './poll/poll-state'

export const STATUS_BAR_ID = 'review-requests'
export const OVERDUE_STATUS_BAR_ID = 'review-requests-overdue'

export type StatusBarLook = {
  text: string
  icon: 'bell' | 'plug' | 'warning'
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  tooltip: string
  visible: boolean
  /** The red count drawn beside the bell; absent hides that item. */
  overdue?: number
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
  const drawn = new Map<string, string>()
  async function draw(id: string, params: object): Promise<void> {
    const key = JSON.stringify(params)
    if (drawn.get(id) === key) return
    await orca.host.call('statusBar.update', { id, ...params })
    drawn.set(id, key)
  }
  return {
    async render(state: PollState): Promise<void> {
      const look = refiners.reduce((current, refine) => refine(current, state), statusBarLook(state))
      const { overdue, ...bell } = look
      await draw(STATUS_BAR_ID, bell)
      await draw(
        OVERDUE_STATUS_BAR_ID,
        overdue === undefined || !look.visible
          ? { visible: false }
          : { text: String(overdue), tone: 'danger', tooltip: look.tooltip, visible: true }
      )
    }
  }
}
