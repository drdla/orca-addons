// The "Merge request updated" notice and Update workspace (#57), end to end through the worker:
// the poll compares the merge request's head with its Review Workspace's HEAD, and Update
// workspace moves a clean workspace to the new head and rebuilds its Review Cover Page. GitLab,
// the orca CLI, git, files and the clock are fakes; Orca's host is the kit's mock host.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import { CONFIGURED, MINUTE, startWorker as startHarness } from './testing/worker-harness'

const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const REPO = { repoId: 'repo-api', projectId: 'git:gitlab.example.com/acme/api', path: '/src/api' }
const WORKTREE = '/wt/review-api-7'
const PAGE = `${WORKTREE}/.orca-review/merge-request.md`
const MR_HEAD_REF = 'refs/remotes/origin/merge-requests/7'

async function startWorker(fakes: Fakes) {
  const host = mockHost({
    settings: CONFIGURED,
    results: {
      'workspace.list': {
        workspaces: [{ id: 'ws-0', kind: 'worktree' as const, name: 'review-api-7', path: WORKTREE, branch: null, hostId: 'local' }],
        truncated: false
      },
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  return startHarness(fakes, CONFIGURED, host)
}

/** A Review Request with a Review Workspace checked out at the merge request's head. */
function reviewingAtHead(fakes: Fakes) {
  const mr = fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login', targetBranch: 'main' })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WORKTREE, references: [MR_URL] })
  fakes.git.setHead(WORKTREE, mr.diffRefs.headSha)
  return mr
}

async function card(worker: Awaited<ReturnType<typeof startWorker>>['worker']) {
  return (await worker.request('rr.snapshot')).reviewRequests.find((c) => c.url === MR_URL)!
}

test('after a push to the merge request, the next poll marks its card "Merge request updated"', async () => {
  const fakes = fakeDeps()
  reviewingAtHead(fakes)
  const { worker } = await startWorker(fakes)
  assert.equal((await card(worker)).mergeRequestUpdated, false)

  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)

  assert.equal((await card(worker)).mergeRequestUpdated, true)
  await worker.deactivate()
})

test("the poll reads a workspace's HEAD only for Review Workspaces, and only when the merge request's head moved", async () => {
  const fakes = fakeDeps()
  reviewingAtHead(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 8, title: 'No workspace' })
  const { worker } = await startWorker(fakes)
  assert.deepEqual(fakes.git.headReads, [WORKTREE])

  await fakes.clock.advance(5 * MINUTE)
  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(fakes.git.headReads, [WORKTREE])

  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(fakes.git.headReads, [WORKTREE, WORKTREE])
  await worker.deactivate()
})

test('Update workspace on a clean workspace moves it to the new head, rebuilds the cover page and clears the notice', async () => {
  const fakes = fakeDeps()
  const mr = reviewingAtHead(fakes)
  const oldHead = mr.diffRefs.headSha
  const { worker } = await startWorker(fakes)
  await worker.request('rr.openCoverPage', { url: MR_URL })
  assert.ok(fakes.files.peek(PAGE)?.includes(`head=${oldHead}`))
  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  const newHead = mr.diffRefs.headSha
  fakes.git.setRef(WORKTREE, MR_HEAD_REF, newHead)

  const snapshot = await worker.request('rr.updateWorkspace', { url: MR_URL })

  // The target branch is fetched too: after a rebase onto a newer target, a stale
  // `origin/main` would put target commits into "Committed on Branch".
  assert.deepEqual(fakes.git.fetches, [
    { repoPath: WORKTREE, branch: 'main' },
    { repoPath: WORKTREE, iid: 7 }
  ])
  assert.deepEqual(fakes.git.resets, [{ worktreePath: WORKTREE, ref: MR_HEAD_REF }])
  const page = fakes.files.peek(PAGE) ?? ''
  assert.ok(page.includes(`<!-- orca-review-cover-page head=${newHead} -->`), page)
  assert.ok(!page.includes('Merge request updated'), page)
  assert.equal(snapshot.reviewRequests.find((c) => c.url === MR_URL)?.mergeRequestUpdated, false)
  // The base is untouched: no workspace is created or re-based, only the branch moves.
  assert.deepEqual(
    fakes.cli.calls.map((c) => c.command).filter((c) => c !== 'worktree list' && c !== 'worktree ps'),
    []
  )
  await fakes.clock.advance(5 * MINUTE)
  assert.equal((await card(worker)).mergeRequestUpdated, false)
  await worker.deactivate()
})

test('reopening the cover page while the workspace is behind puts the callout at its top, without rebuilding it', async () => {
  const fakes = fakeDeps()
  const mr = reviewingAtHead(fakes)
  const oldHead = mr.diffRefs.headSha
  const { worker } = await startWorker(fakes)
  await worker.request('rr.openCoverPage', { url: MR_URL })
  assert.ok(!(fakes.files.peek(PAGE) ?? '').includes('Merge request updated'))
  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  const gitLabReads = fakes.gitlab.requests.filter((r) => r.operation.startsWith('GET /projects')).length

  await worker.request('rr.openCoverPage', { url: MR_URL })

  const page = fakes.files.peek(PAGE) ?? ''
  assert.match(page, /^# Add login\n\n> \*\*Merge request updated\.\*\* /)
  assert.ok(page.includes(`<!-- orca-review-cover-page head=${oldHead} -->`), page)
  assert.equal(fakes.gitlab.requests.filter((r) => r.operation.startsWith('GET /projects')).length, gitLabReads)
  await worker.deactivate()
})

test('Update workspace on a workspace with uncommitted changes refuses and changes nothing', async () => {
  const fakes = fakeDeps()
  const mr = reviewingAtHead(fakes)
  const { worker } = await startWorker(fakes)
  await worker.request('rr.openCoverPage', { url: MR_URL })
  const pageBefore = fakes.files.peek(PAGE)
  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  fakes.git.setRef(WORKTREE, MR_HEAD_REF, mr.diffRefs.headSha)
  fakes.git.setStatus(WORKTREE, [' M src/login.ts', '?? .orca-review/'])

  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), (error) =>
    /review-api-7 has 1 uncommitted change: commit or stash them first\. Nothing was changed\./.test(String(error))
  )

  assert.deepEqual(fakes.git.fetches, [])
  assert.deepEqual(fakes.git.resets, [])
  assert.equal(fakes.files.peek(PAGE), pageBefore)
  assert.equal((await card(worker)).mergeRequestUpdated, true)
  await worker.deactivate()
})
