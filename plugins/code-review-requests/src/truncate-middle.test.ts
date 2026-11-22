import { assert, test } from 'orca/testing'
import { truncateMiddle } from './truncate-middle'

test('truncateMiddle leaves short text alone', () => {
  assert.equal(truncateMiddle('src/a.ts', 60, 14), 'src/a.ts')
  assert.equal(truncateMiddle('x'.repeat(60), 60, 14), 'x'.repeat(60))
})

test('truncateMiddle keeps the start and the last characters, max long', () => {
  const path = 'apps/admin/src/modules/universalFilters/components/filters/TimeframeFilter.tsx'
  const short = truncateMiddle(path, 60, 14)
  assert.equal(short.length, 60)
  assert.ok(short.startsWith('apps/admin/src/modules/'))
  assert.ok(short.endsWith('…' + path.slice(-14)))
})

test('truncateMiddle with keepEnd past max keeps only the end', () => {
  assert.equal(truncateMiddle('abcdefghij', 5, 9), '…ghij')
})
