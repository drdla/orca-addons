// The git argument lists the real Git seam runs (#54).
import { assert, test } from 'orca/testing'
import { fetchBranchArgs, isAncestorArgs, parsePorcelainZ, resetBranchArgs, unsetUpstreamArgs } from './git-process'

test('fetches a target branch with slashes fresh into its remote-tracking ref', () => {
  assert.deepEqual(fetchBranchArgs('/src/api', 'release/1.2'), [
    '-C', '/src/api', 'fetch', '--no-tags', 'origin', '+refs/heads/release/1.2:refs/remotes/origin/release/1.2'
  ])
})

test('moves the worktree branch to a full ref and drops its upstream', () => {
  assert.deepEqual(resetBranchArgs('/wt/review-api-7', 'refs/remotes/origin/merge-requests/7'), [
    '-C', '/wt/review-api-7', 'reset', '--hard', 'refs/remotes/origin/merge-requests/7', '--'
  ])
  assert.deepEqual(unsetUpstreamArgs('/wt/review-api-7'), ['-C', '/wt/review-api-7', 'branch', '--unset-upstream'])
})

test('reads `git status --porcelain -z`: one entry per change, a rename once, paths unquoted', () => {
  assert.deepEqual(parsePorcelainZ('R  new name.ts\0old name.ts\0?? .orca-review/\0 M "odd".ts\0'), [
    'R  new name.ts',
    '?? .orca-review/',
    ' M "odd".ts'
  ])
  assert.deepEqual(parsePorcelainZ(''), [])
})

test('asks git whether one commit is an ancestor of another', () => {
  assert.deepEqual(isAncestorArgs('/wt/review-api-7', 'aaa', 'bbb'), [
    '-C', '/wt/review-api-7', 'merge-base', '--is-ancestor', 'aaa', 'bbb'
  ])
})
