// The filter rules (#9, #26): which Review Requests are shown, given the three filter settings.
import { assert, test } from 'orca/testing'
import { applyFilters, parseFilters } from './filters'
import type { ReviewRequestView } from './protocol'

function rr(projectPath: string, author = 'ada', iid = 1): ReviewRequestView {
  return {
    url: `https://gitlab.example.com/${projectPath}/-/merge_requests/${iid}`,
    title: `MR ${iid}`,
    projectPath,
    iid,
    author,
    requestedAt: 0
  }
}

const NO_RULES = { pathAllowlist: '', pathBlocklist: '', authorBlocklist: '' }

function shownPaths(list: ReviewRequestView[], settings: Partial<typeof NO_RULES>): string[] {
  const { filters } = parseFilters({ ...NO_RULES, ...settings })
  return applyFilters(list, filters).visible.map((r) => r.projectPath)
}

test('with no rules every Review Request is shown', () => {
  assert.deepEqual(shownPaths([rr('acme/api'), rr('other/web')], {}), ['acme/api', 'other/web'])
})

test('an allowlist path matches itself and everything below it, but not a sibling with the same prefix', () => {
  const list = [rr('acme/platform'), rr('acme/platform/api'), rr('acme/platform-old'), rr('acme/web')]
  assert.deepEqual(shownPaths(list, { pathAllowlist: 'acme/platform' }), ['acme/platform', 'acme/platform/api'])
})

test('* stands for exactly one path segment', () => {
  const list = [rr('acme/a/api'), rr('acme/b/api/x'), rr('acme/api'), rr('acme/a/b/api'), rr('acme/a/web')]
  assert.deepEqual(shownPaths(list, { pathAllowlist: 'acme/*/api' }), ['acme/a/api', 'acme/b/api/x'])
})

test('matching is case-insensitive', () => {
  assert.deepEqual(shownPaths([rr('Acme/API'), rr('acme/web', 'Bob')], { pathAllowlist: 'ACME/api' }), ['Acme/API'])
  assert.deepEqual(shownPaths([rr('acme/api', 'Bob'), rr('acme/web', 'ada')], { authorBlocklist: 'bob' }), ['acme/web'])
})

test('the blocklist wins over the allowlist', () => {
  const list = [rr('acme/api'), rr('acme/legacy/api'), rr('acme/legacy')]
  assert.deepEqual(shownPaths(list, { pathAllowlist: 'acme', pathBlocklist: 'acme/legacy' }), ['acme/api'])
})

test('blocked authors are hidden, written with or without a leading @', () => {
  const list = [rr('acme/api', 'renovate-bot'), rr('acme/api', 'dependabot'), rr('acme/api', 'ada')]
  const { filters } = parseFilters({ ...NO_RULES, authorBlocklist: 'renovate-bot, @dependabot' })
  assert.deepEqual(
    applyFilters(list, filters).visible.map((r) => r.author),
    ['ada']
  )
})

test('entries are separated by commas, spaces or new lines', () => {
  const list = [rr('a/x'), rr('b/x'), rr('c/x'), rr('d/x')]
  assert.deepEqual(shownPaths(list, { pathBlocklist: 'a, b\nc' }), ['d/x'])
})

test('invalid entries are ignored and reported', () => {
  const { filters, invalid } = parseFilters({
    pathAllowlist: 'acme//api, https://gitlab.com/acme, acme/ap*',
    pathBlocklist: '/acme/legacy/',
    authorBlocklist: 'bad name!, @, ok'
  })
  assert.deepEqual(invalid, ['acme//api', 'https://gitlab.com/acme', 'acme/ap*', 'name!', '@'])
  // Only invalid allowlist entries: the allowlist counts as empty, so nothing is hidden by it.
  const shown = applyFilters([rr('acme/api'), rr('acme/legacy/x'), rr('z/z', 'ok')], filters).visible
  assert.deepEqual(
    shown.map((r) => r.projectPath),
    ['acme/api']
  )
})

test('counts what the filters hide', () => {
  const { filters } = parseFilters({ ...NO_RULES, pathBlocklist: 'acme' })
  const result = applyFilters([rr('acme/api'), rr('acme/web'), rr('other/x')], filters)
  assert.equal(result.visible.length, 1)
  assert.deepEqual(
    result.hidden.map((r) => r.projectPath),
    ['acme/api', 'acme/web']
  )
})

test('filters never hide a Review Request that already has a Review Workspace', () => {
  const { filters } = parseFilters({ ...NO_RULES, pathBlocklist: 'acme', authorBlocklist: 'bob' })
  const kept = rr('acme/api', 'bob', 7)
  const result = applyFilters([kept, rr('acme/web')], filters, (r) => r.url === kept.url)
  assert.deepEqual(result.visible, [kept])
  assert.equal(result.hidden.length, 1)
})
