// The status bar item's extension point: refiners change the look (overdue #22, problem states #24).
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

  assert.deepEqual(host.callsOf('statusBar.update'), [
    {
      id: 'review-requests',
      text: '0',
      icon: 'check',
      tone: 'danger',
      tooltip: '0 Review Requests. Click to open.',
      visible: false
    },
    {
      id: 'review-requests',
      text: 'GitLab: offline',
      icon: 'check',
      tone: 'danger',
      tooltip: '0 Review Requests. Click to open.',
      visible: true
    }
  ])
})
