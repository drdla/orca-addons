// The extension points later slices hang off: what each listener hears, and in which order.
import { assert, test } from 'orca/testing'
import type { ReviewRequestView } from '../protocol'
import { createPollState, snapshotOf, type PollState } from './poll-state'

function rr(iid: number): ReviewRequestView {
  return {
    url: `https://gitlab.example.com/acme/api/-/merge_requests/${iid}`,
    title: `MR ${iid}`,
    projectPath: 'acme/api',
    iid,
    author: 'ada'
  }
}

test('the first success has no previous list to compare with; later ones do', async () => {
  const store = createPollState()
  const heard: [number[] | null, number[]][] = []
  store.onSucceeded((previous, next) => {
    heard.push([previous?.reviewRequests.map((r) => r.iid) ?? null, next.reviewRequests.map((r) => r.iid)])
  })

  await store.record({ ok: true, at: 1, reviewRequests: [rr(1)] })
  await store.record({ ok: true, at: 2, reviewRequests: [rr(1), rr(2)] })

  assert.deepEqual(heard, [
    [null, [1]],
    [[1], [1, 2]]
  ])
})

test('a failure keeps the last good list, and success listeners do not hear it', async () => {
  const store = createPollState()
  const order: string[] = []
  let failedWith: PollState | null = null
  store.onSucceeded(() => void order.push('succeeded'))
  store.onFailed((error, state) => {
    order.push(`failed: ${(error as Error).message}`)
    failedWith = state
  })
  store.onChange(() => void order.push('changed'))

  await store.record({ ok: true, at: 1, reviewRequests: [rr(1)] })
  await store.record({ ok: false, at: 2, error: new Error('offline') })

  assert.deepEqual(order, ['succeeded', 'changed', 'failed: offline', 'changed'])
  assert.deepEqual(failedWith, {
    reviewRequests: [rr(1)],
    lastSuccessAt: 1,
    lastAttemptAt: 2,
    lastError: new Error('offline')
  })
  assert.deepEqual(snapshotOf(store.current()), { reviewRequests: [rr(1)] })
})

test('a listener that throws is logged and does not stop the others', async () => {
  const logs: string[] = []
  const store = createPollState((message) => logs.push(message))
  let changed = 0
  store.onChange(() => {
    throw new Error('boom')
  })
  store.onChange(() => void changed++)

  await store.record({ ok: true, at: 1, reviewRequests: [] })

  assert.equal(changed, 1)
  assert.equal(logs.length, 1)
  assert.match(logs[0]!, /boom/)
})

test('a disposed listener hears nothing more', async () => {
  const store = createPollState()
  let heard = 0
  store.onChange(() => void heard++).dispose()

  await store.record({ ok: true, at: 1, reviewRequests: [] })
  assert.equal(heard, 0)
})
