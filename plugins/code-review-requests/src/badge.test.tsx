// The Badge wrapper: a dot gets a non-breaking space after it. The test renderer trims text, so
// this looks at what the wrapper hands Orca's Badge.
import { assert, test } from 'orca/testing'
import { Badge } from './badge'

const label = (element: unknown) => (element as { props: { children: unknown } }).props.children

test('a Badge with a dot starts its text with a non-breaking space', () => {
  assert.equal(label(Badge({ tone: 'warning', children: 'Changes requested' })), ' Changes requested')
  assert.equal(label(Badge({ tone: 'success', children: 'Posted' })), ' Posted')
})

test('a Badge without a dot keeps its text as it is', () => {
  assert.equal(label(Badge({ tone: 'neutral', children: 'Commented' })), 'Commented')
  assert.equal(label(Badge({ children: '1/2 approvals' })), '1/2 approvals')
})
