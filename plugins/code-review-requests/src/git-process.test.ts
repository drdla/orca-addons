// The git argument lists the real Git seam runs (#54).
import { assert, test } from 'orca/testing'
import { fetchBranchArgs, resetBranchArgs, unsetUpstreamArgs } from './git-process'

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
