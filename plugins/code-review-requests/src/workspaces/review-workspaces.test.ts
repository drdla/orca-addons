// Finding the Review Workspace and the Orca repo for a Review Request in one `orca worktree list`
// (#7): any workspace linked to the MR URL; no fallback to branch names.
import { assert, test } from 'orca/testing'
import { FakeOrcaCli } from '../fakes'
import { findRepo, findReviewWorkspace, hasReviewWorkspace, workspaceIndexOf } from './review-workspaces'

const MR = { url: 'https://gitlab.example.com/acme/api/-/merge_requests/7', projectPath: 'acme/api', iid: 7 }

async function indexOf(cli: FakeOrcaCli) {
  return workspaceIndexOf(await cli.listWorktrees())
}

test('finds the workspace linked to the MR URL', async () => {
  const cli = new FakeOrcaCli()
  cli.addWorktree({ name: 'other', references: ['https://gitlab.example.com/acme/api/-/merge_requests/8'] })
  const linked = cli.addWorktree({ name: 'mine', references: [MR.url] })

  const index = await indexOf(cli)

  assert.equal(findReviewWorkspace(index, MR)?.id, linked.id)
  assert.equal(hasReviewWorkspace(index, MR), true)
})

test('matches the link however its URL is spelled: host case, a trailing slash, a tab or a query', async () => {
  const cli = new FakeOrcaCli()
  const linked = cli.addWorktree({
    name: 'mine',
    references: ['https://GitLab.Example.com/acme/api/-/merge_requests/7/diffs?commit_id=abc#note_1']
  })

  assert.equal(findReviewWorkspace(await indexOf(cli), MR)?.id, linked.id)
})

test('a workspace linked only through the legacy MR number of the same project counts too', async () => {
  const cli = new FakeOrcaCli()
  const legacy = cli.addWorktree({ name: 'legacy', legacyGitLabMR: 7, projectId: 'git:gitlab.example.com/acme/api' })
  cli.addWorktree({ name: 'elsewhere', legacyGitLabMR: 7, projectId: 'git:gitlab.example.com/acme/web' })

  assert.equal(findReviewWorkspace(await indexOf(cli), MR)?.id, legacy.id)
})

test('a workspace on the same branch but without the link is not the Review Workspace', async () => {
  const cli = new FakeOrcaCli()
  cli.addWorktree({ name: 'feature-7', branch: 'feature-7' })

  assert.equal(findReviewWorkspace(await indexOf(cli), MR), null)
  assert.equal(hasReviewWorkspace(await indexOf(cli), MR), false)
})

test('the Orca repo of an MR is the one whose project is the MR project on that host', async () => {
  const cli = new FakeOrcaCli()
  cli.addRepo({ repoId: 'web', projectId: 'git:gitlab.example.com/acme/web', path: '/src/web' })
  cli.addRepo({ repoId: 'api', projectId: 'git:gitlab.example.com/ACME/api', path: '/src/api' })

  const repo = findRepo(await indexOf(cli), MR)

  assert.equal(repo?.repoId, 'api')
  assert.equal(repo?.path, '/src/api')
  assert.equal(findRepo(await indexOf(cli), { ...MR, url: 'https://gitlab.other.com/acme/api/-/merge_requests/7' }), null)
})
