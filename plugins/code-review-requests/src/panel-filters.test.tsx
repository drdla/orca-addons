// What the panel says about the filter settings (#26): how many Review Requests they hide, and
// which entries it ignores.
import { assert, mockHost, test } from 'orca/testing'
import { mount } from './testing/mount'
import * as panel from './panel'
import type { ReviewRequestsSnapshot } from './protocol'

const NOW = Date.UTC(2026, 10, 16, 9, 0)

function snapshot(extra: Partial<ReviewRequestsSnapshot>): ReviewRequestsSnapshot {
  return { reviewRequests: [], refreshedAt: NOW, ...extra }
}

test('says how many Review Requests the filters hide, and where to change them', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot({ hiddenByFilters: 3 }) } })
  const view = await mount(panel, { host })

  assert.ok(view.find({ text: /3 hidden by filters/ }))
  assert.ok(view.find({ text: /Settings/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says nothing about filters when they hide nothing', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot({}) } })
  const view = await mount(panel, { host })

  assert.equal(view.find({ text: /hidden by filters/ }), null)
  assert.equal(view.find({ type: 'Callout' }), null)
  await view.unmount()
})

test('warns about filter entries it ignores', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot({ invalidFilterEntries: ['acme//api', 'no!'] }) }
  })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Callout' }))
  assert.ok(view.find({ text: /acme\/\/api, no!/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
