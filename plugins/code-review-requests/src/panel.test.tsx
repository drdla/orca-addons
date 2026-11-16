import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

test('shows that there is nothing to review when the worker has no Review Requests', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: null } } })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Heading', text: 'Review Requests' }))
  assert.ok(view.find({ type: 'EmptyState' }))
  assert.ok(view.find({ text: 'Nothing to review' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('says so, without throwing, when the worker cannot answer', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': () => {
        throw hostError('unavailable', 'worker not running')
      }
    }
  })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Callout' }))
  assert.ok(view.find({ text: /worker not running/ }))
  assert.equal(view.find({ type: 'EmptyState' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
