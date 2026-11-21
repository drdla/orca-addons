// The panel's search rules: what a query matches, and which tab a search switches to.
import { assert, test } from 'orca/testing'
import { matchesQuery, normalizeQuery, tabWithMatches } from './search'

const card = {
  url: 'https://gitlab.example.com/acme/web/-/merge_requests/3021',
  title: 'DNI-1645: One timeframe row for the invoice v2 and inbox date filters'
}

function matches(query: string): boolean {
  return matchesQuery(card, normalizeQuery(query))
}

test('an empty or blank query matches every card', () => {
  assert.ok(matches(''))
  assert.ok(matches('   '))
})

test('a query matches part of the title, ignoring case', () => {
  assert.ok(matches('dni-1645'))
  assert.ok(matches('  Invoice V2 '))
  assert.ok(!matches('DNI-1646'))
})

test('a query matches part of the MR URL, so the MR number finds its card', () => {
  assert.ok(matches('3021'))
  assert.ok(matches('!3021') === false, 'the `!` is not part of the URL')
  assert.ok(matches('acme/web'))
  assert.ok(matches('302'), 'contains, not equals')
})

test('a pasted MR link finds its card, with or without a suffix', () => {
  assert.ok(matches(card.url))
  assert.ok(matches(`${card.url}/diffs`))
  assert.ok(matches(`${card.url}/diffs?commit_id=abc#note_123`))
  assert.ok(matches(`${card.url}#note_123`))
  assert.ok(matches(`${card.url}/`))
  assert.ok(matches('HTTPS://GITLAB.EXAMPLE.COM/acme/web/-/merge_requests/3021'))
})

test('a link to another MR does not match', () => {
  assert.ok(!matches('https://gitlab.example.com/acme/web/-/merge_requests/3022/diffs'))
  assert.ok(!matches('https://gitlab.example.com/acme/api/-/merge_requests/3021'))
})

test('normalizeQuery cuts a merge request link back to the MR', () => {
  assert.equal(
    normalizeQuery(' https://gitlab.example.com/a/b/-/merge_requests/7/diffs#note_1 '),
    'https://gitlab.example.com/a/b/-/merge_requests/7'
  )
  assert.equal(normalizeQuery('Fix Login'), 'fix login')
})

test('the selected tab stays while it has a match', () => {
  assert.equal(tabWithMatches({ todo: 1, in: 2, ended: 0 }, 'todo'), 'todo')
})

test('with no match on the selected tab, the one tab that has matches is selected', () => {
  assert.equal(tabWithMatches({ todo: 0, in: 1, ended: 0 }, 'todo'), 'in')
  assert.equal(tabWithMatches({ todo: 0, in: 0, ended: 2 }, 'in'), 'ended')
})

test('the selected tab stays when no tab or several others have matches', () => {
  assert.equal(tabWithMatches({ todo: 0, in: 0, ended: 0 }, 'todo'), 'todo')
  assert.equal(tabWithMatches({ todo: 0, in: 1, ended: 1 }, 'todo'), 'todo')
})
