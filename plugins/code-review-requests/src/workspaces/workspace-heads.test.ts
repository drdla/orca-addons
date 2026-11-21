// The "Merge request updated" detection (#57) at its own seam: a poll's HEAD read that finishes
// after Update workspace recorded the new HEAD must not bring the notice back.
import { assert, test } from 'orca/testing'
import { FakeGit, FakeOrcaCli } from '../fakes'
import { createWorkspaceHeads } from './workspace-heads'
import { createWorkspaceTracker } from './workspace-tracker'

const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const WORKTREE = '/wt/review-api-7'
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

test("a poll's HEAD read that lands after Update workspace recorded the new HEAD is dropped", async () => {
  const cli = new FakeOrcaCli()
  cli.addWorktree({ name: 'review-api-7', path: WORKTREE, references: [MR_URL] })
  const workspaces = createWorkspaceTracker(() => cli, () => {})
  const state = await workspaces.refresh()
  const git = new FakeGit()
  let answer!: (sha: string) => void
  git.headSha = (path: string) => {
    git.headReads.push(path)
    return new Promise<string>((resolve) => (answer = resolve))
  }
  const heads = createWorkspaceHeads(git, () => {})
  const rr = { url: MR_URL, title: 'Add login', projectPath: 'acme/api', iid: 7, author: 'ada', requestedAt: 0 }

  const polling = heads.check([{ ...rr, mergeRequestHead: NEW }], state)
  heads.record(WORKTREE, NEW)
  answer(OLD)
  await polling

  assert.equal(heads.isBehind(WORKTREE, NEW), false)
})
