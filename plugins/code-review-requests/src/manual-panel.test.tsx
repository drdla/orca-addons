// The Manual view: the ⓘ between Refresh and Settings opens it, Back returns to the tabs.
import { assert, mockHost, mount, test } from 'orca/testing'
import { MANUAL_SECTIONS } from './manual-view'
import * as panel from './panel'
import type { ReviewRequestsSnapshot } from './protocol'

const NOW = Date.UTC(2026, 10, 16, 9, 0)
const healthy: ReviewRequestsSnapshot = { reviewRequests: [], refreshedAt: NOW }

test('the header has Refresh, then the Manual, then Settings', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'rr.snapshot': healthy } }) })

  const order = view
    .findAll({})
    .map((node) => node.props.tooltip ?? node.props.label)
    .filter((name) => name === 'Refresh' || name === 'Manual' || name === 'Settings')
  assert.deepEqual([...new Set(order)], ['Refresh', 'Manual', 'Settings'])
  await view.unmount()
})

test('the ⓘ opens the Manual with every section, and Back returns to the selected tab', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': healthy } }),
    persisted: { plugin: { 'rr.tab': 'ended' } }
  })

  await view.press(view.find({ type: 'IconButton', label: 'Manual' })!)
  assert.ok(view.find({ type: 'Heading', text: 'Manual' }))
  assert.equal(view.find({ type: 'Tabs' }), null)
  for (const section of MANUAL_SECTIONS) assert.ok(view.find({ type: 'Heading', text: section.title }), section.title)

  await view.press(view.find({ type: 'Button', text: /Back/ })!)
  assert.equal(view.find({ type: 'Heading', text: 'Manual' }), null)
  assert.equal(view.valueOf(view.find({ type: 'Tabs' })!), 'ended')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
