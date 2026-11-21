// The bell's extension point: refiners change the look (overdue #22, problem states #24), and
// the look's `overdue` draws the red count as a second item.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { INITIAL_POLL_STATE } from './poll/poll-state'
import { createStatusBar } from './status-bar'

async function hostApi() {
  const host = mockHost()
  let api: OrcaWorkerApi | undefined
  await mountWorker({ default: (orca: OrcaWorkerApi) => void (api = orca) }, { host })
  return { host, orca: api! }
}

test('refiners change the look in order, and an unchanged look is not sent again', async () => {
  const { host, orca } = await hostApi()
  const bar = createStatusBar(orca, [
    (look) => ({ ...look, tone: 'danger' }),
    (look, state) => (state.lastError === null ? look : { ...look, text: 'GitLab: offline', visible: true })
  ])

  await bar.render(INITIAL_POLL_STATE)
  await bar.render(INITIAL_POLL_STATE)
  await bar.render({ ...INITIAL_POLL_STATE, lastError: new Error('offline') })

  const bell = host.callsOf('statusBar.update').filter((call) => (call as { id: string }).id === 'review-requests')
  assert.deepEqual(bell, [
    {
      id: 'review-requests',
      text: '0',
      icon: 'bell',
      tone: 'danger',
      tooltip: '0 Review Requests. Click to open.',
      visible: false
    },
    {
      id: 'review-requests',
      text: 'GitLab: offline',
      icon: 'bell',
      tone: 'danger',
      tooltip: '0 Review Requests. Click to open.',
      visible: true
    }
  ])
})

test('the overdue count is a second, red item, hidden whenever the bell is', async () => {
  const { host, orca } = await hostApi()
  const reviewRequests = [{}] as unknown as typeof INITIAL_POLL_STATE.reviewRequests
  const bar = createStatusBar(orca, [
    (look) => ({ ...look, text: '2 |', overdue: 3 }),
    (look, state) => (state.lastError === null ? look : { ...look, overdue: undefined })
  ])
  const overdueItem = () =>
    host.callsOf('statusBar.update').filter((call) => (call as { id: string }).id === 'review-requests-overdue')

  await bar.render({ ...INITIAL_POLL_STATE, reviewRequests })
  await bar.render({ ...INITIAL_POLL_STATE, reviewRequests, lastError: new Error('offline') })
  await bar.render(INITIAL_POLL_STATE)

  assert.deepEqual(overdueItem(), [
    {
      id: 'review-requests-overdue',
      text: '3',
      tone: 'danger',
      tooltip: '1 Review Request. Click to open.',
      visible: true
    },
    { id: 'review-requests-overdue', visible: false }
  ])
})
