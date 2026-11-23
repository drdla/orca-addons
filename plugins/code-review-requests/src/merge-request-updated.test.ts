// The "Merge request updated" notice and Update workspace (#57), end to end through the worker:
// the poll compares the merge request's head with its Review Workspace's HEAD, and Update
// workspace moves a clean workspace to the new head and rebuilds its Review Cover Page. GitLab,
// the orca CLI, git, files and the clock are fakes; Orca's host is the kit's mock host.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { targetBranchFullRef } from './seams/git'
import { fakeDeps, type Fakes } from './fakes'
import { createReviewDrafts } from './review-draft/review-drafts'
import type { DiffComment } from './seams/orca-cli'
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
function reviewingAtHead(fakes: Fakes, options: { fetchedBefore?: boolean } = {}) {
  const mr = fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login', targetBranch: 'main' })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WORKTREE, references: [MR_URL] })
  fakes.git.setHead(WORKTREE, mr.diffRefs.headSha)
  // Start review fetched the merge request's head then.
  if (options.fetchedBefore !== false) fakes.git.setRef(WORKTREE, MR_HEAD_REF, mr.diffRefs.headSha)
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

const NOTE: DiffComment = {
  id: 'n1',
  worktreeId: `${REPO.repoId}::${WORKTREE}`,
  filePath: 'src/login.ts',
  lineNumber: 10,
  body: 'Why not reuse the helper?',
  createdAt: 1_000,
  side: 'modified',
  scope: 'branch'
}

/** The Review Drafts in the plugin's storage on `host`, as another worker of the plugin sees them. */
async function draftsOn(fakes: Fakes, host: ReturnType<typeof mockHost>) {
  let storage: OrcaWorkerApi['storage'] | undefined
  await mountWorker({ default: (api: OrcaWorkerApi) => void (storage = api.storage) }, { host })
  return createReviewDrafts(storage!, fakes.clock)
}

test('Update workspace opens no Review Draft; the next import gives notes written before it the head it left (#58)', async () => {
  const fakes = fakeDeps()
  const { worker, host, oldHead, newHead } = await behind(fakes)
  // Written in Orca's diff view; the Review Draft was never opened.
  fakes.cli.setDiffComments(NOTE.worktreeId, [NOTE])
  fakes.git.setFileChanges(oldHead, newHead, [
    { oldPath: 'src/login.ts', newPath: 'src/login.ts', hunks: [{ start: 10, count: 2 }] }
  ])
  const drafts = await draftsOn(fakes, host)

  await worker.request('rr.updateWorkspace', { url: MR_URL })

  // Card counts and removal protection follow the Review Draft, and there still is none.
  assert.equal(await drafts.get(MR_URL), null)
  assert.equal(await drafts.hasUnposted(MR_URL), false)
  assert.equal((await card(worker)).toPost, 0)

  const draft = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(draft.comments.map((c) => [c.id, c.sha, c.outdated]), [['note:n1', oldHead, true]])

  // Applied once: a note written after that import is at the workspace's HEAD. One reworded in
  // Orca is still on the lines it was written on, at the old head.
  fakes.cli.setDiffComments(NOTE.worktreeId, [
    { ...NOTE, body: 'Reuse the helper.', updatedAt: 9_000 },
    { ...NOTE, id: 'n2', lineNumber: 30 }
  ])
  const again = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(
    again.comments.map((c) => [c.id, c.sha, c.outdated]),
    [
      ['note:n1', oldHead, true],
      ['note:n2', newHead, undefined]
    ]
  )
  await worker.deactivate()
})

test('Update workspace imports into a Review Draft that exists, at the head it left (#58)', async () => {
  const fakes = fakeDeps()
  const { worker, host, oldHead } = await behind(fakes)
  fakes.cli.setDiffComments(NOTE.worktreeId, [NOTE])
  await worker.request('rr.draft', { url: MR_URL })
  // A second note, written before the update; the Review Draft wasn't imported again.
  fakes.cli.setDiffComments(NOTE.worktreeId, [NOTE, { ...NOTE, id: 'n2', lineNumber: 30 }])

  await worker.request('rr.updateWorkspace', { url: MR_URL })

  const stored = await (await draftsOn(fakes, host)).get(MR_URL)
  assert.deepEqual(stored?.comments.map((c) => [c.id, c.sha]), [
    ['note:n1', oldHead],
    ['note:n2', oldHead]
  ])
  await worker.deactivate()
})

test('when Update workspace fails after the workspace moved, notes written before it still keep the head it left (#58)', async () => {
  const fakes = fakeDeps()
  const { worker, oldHead } = await behind(fakes)
  fakes.cli.setDiffComments(NOTE.worktreeId, [NOTE])
  fakes.git.failAfterNextReset(new Error('git branch --unset-upstream failed: locked'))

  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), /finishing the reset failed/)

  const draft = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(draft.comments.map((c) => [c.id, c.sha]), [['note:n1', oldHead]])
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
  const { host, worker } = await startWorker(fakes)
  await worker.request('rr.openCoverPage', { url: MR_URL })
  assert.ok(fakes.files.peek(PAGE)?.includes(`head=${oldHead}`))
  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  const newHead = mr.diffRefs.headSha
  fakes.git.setRemoteMergeRequestHead(7, newHead)

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
  // The rebuilt page comes to the front, so the reviewer sees what changed.
  assert.equal(host.callsOf('editor.open').length, 2)
  // The base is untouched: no workspace is created or re-based, only the branch moves. (Reading
  // the diff-view notes into the Review Draft, #58, changes nothing.)
  assert.deepEqual(
    fakes.cli.calls
      .map((c) => c.command)
      .filter((c) => c !== 'worktree list' && c !== 'worktree ps' && c !== 'worktree show'),
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

test('Open workspace on a workspace that is behind puts the callout on its existing cover page', async () => {
  const fakes = fakeDeps()
  reviewingAtHead(fakes)
  const { worker } = await startWorker(fakes)
  await worker.request('rr.openCoverPage', { url: MR_URL })
  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)

  await worker.request('rr.openWorkspace', { url: MR_URL })

  assert.match(fakes.files.peek(PAGE) ?? '', /^# Add login\n\n> \*\*Merge request updated\.\*\* /)
  await worker.deactivate()
})

test("a cover page built for another commit than the workspace's HEAD is rebuilt when it is opened", async () => {
  const fakes = fakeDeps()
  reviewingAtHead(fakes)
  const { worker } = await startWorker(fakes)
  await worker.request('rr.openCoverPage', { url: MR_URL })
  // The workspace moved on, but its page wasn't rebuilt (a rebuild that failed, say).
  const moved = 'c0ffee0000000000000000000000000000000000'
  fakes.git.setHead(WORKTREE, moved)

  await worker.request('rr.openCoverPage', { url: MR_URL })

  assert.ok((fakes.files.peek(PAGE) ?? '').includes(`<!-- orca-review-cover-page head=${moved} -->`))
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
  fakes.git.setRemoteMergeRequestHead(7, mr.diffRefs.headSha)
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

/** A Review Workspace whose merge request has a new head the next fetch brings, after a poll. */
async function behind(fakes: Fakes, options: { fetchedBefore?: boolean } = {}) {
  const mr = reviewingAtHead(fakes, options)
  const oldHead = mr.diffRefs.headSha
  const started = await startWorker(fakes)
  fakes.gitlab.push('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  const newHead = mr.diffRefs.headSha
  fakes.git.setRemoteMergeRequestHead(7, newHead)
  return { ...started, oldHead, newHead }
}

test("Update workspace refuses a workspace with commits of the reviewer's own, before fetching anything", async () => {
  const fakes = fakeDeps()
  const { worker, oldHead } = await behind(fakes)
  const local = 'ad0be00000000000000000000000000000000000'
  fakes.git.setHead(WORKTREE, local)
  fakes.git.addAncestor(oldHead, local)

  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), (error) =>
    /review-api-7 has local commits that aren't in the merge request; nothing was changed\./.test(String(error))
  )
  assert.deepEqual(fakes.git.fetches, [])
  assert.deepEqual(fakes.git.resets, [])
  await worker.deactivate()
})

test('Update workspace moves a workspace stuck at the target branch (a Start review cut off before its reset)', async () => {
  const fakes = fakeDeps()
  const { worker, newHead } = await behind(fakes)
  // Created from main, never reset to the MR; main has moved on since.
  const mainThen = 'da1a000000000000000000000000000000000000'
  const mainNow = 'da1b000000000000000000000000000000000000'
  fakes.git.setHead(WORKTREE, mainThen)
  fakes.git.setRef(WORKTREE, targetBranchFullRef('main'), mainNow)
  fakes.git.addAncestor(mainThen, mainNow)

  await worker.request('rr.updateWorkspace', { url: MR_URL })

  assert.equal(fakes.git.resets.length, 1, 'the target branch has no commits of the reviewer')
  assert.ok((fakes.files.peek(PAGE) ?? '').includes(`head=${newHead}`))
  await worker.deactivate()
})

test('Update workspace moves a workspace whose merge request was force-pushed (rebased)', async () => {
  const fakes = fakeDeps()
  // The new head doesn't descend from the old one; the workspace has no commits of its own.
  const { worker, newHead } = await behind(fakes)

  await worker.request('rr.updateWorkspace', { url: MR_URL })

  assert.equal(fakes.git.resets.length, 1)
  assert.ok((fakes.files.peek(PAGE) ?? '').includes(`head=${newHead}`))
  await worker.deactivate()
})

test('without an earlier fetch of the merge request, Update workspace refuses unless HEAD is in the new head', async () => {
  const fakes = fakeDeps()
  const { worker, oldHead, newHead } = await behind(fakes, { fetchedBefore: false })

  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), /local commits/)
  assert.deepEqual(fakes.git.resets, [])

  fakes.git.addAncestor(oldHead, newHead)
  await worker.request('rr.updateWorkspace', { url: MR_URL })
  assert.equal(fakes.git.resets.length, 1)
  await worker.deactivate()
})

test('Update workspace checks for uncommitted changes again right before the reset', async () => {
  const fakes = fakeDeps()
  const { worker } = await behind(fakes)
  fakes.git.onNextOf('fetchMergeRequestHead', () => fakes.git.setStatus(WORKTREE, [' M src/login.ts']))

  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), /commit or stash them first/)
  assert.deepEqual(fakes.git.resets, [])
  assert.equal((await card(worker)).mergeRequestUpdated, true)
  await worker.deactivate()
})

test('a second Update workspace while the first runs joins it: one reset', async () => {
  const fakes = fakeDeps()
  const { worker } = await behind(fakes)

  await Promise.all([
    worker.request('rr.updateWorkspace', { url: MR_URL }),
    worker.request('rr.updateWorkspace', { url: MR_URL })
  ])

  assert.equal(fakes.git.resets.length, 1)
  await worker.deactivate()
})

test('Update workspace while Start review runs for the same merge request is refused', async () => {
  const fakes = fakeDeps()
  const { worker } = await behind(fakes)

  const starting = worker.request('rr.startReview', { url: MR_URL, withAgent: false })
  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), /Start Review is still running/)
  await starting
  assert.deepEqual(fakes.git.resets, [])
  await worker.deactivate()
})

test('when the branch moved but a later step failed, the notice clears and the error names the step', async () => {
  const fakes = fakeDeps()
  const { worker } = await behind(fakes)
  fakes.git.failAfterNextReset(new Error('git branch --unset-upstream failed: locked'))

  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), (error) =>
    /moved to the new head, but finishing the reset failed: git branch --unset-upstream failed: locked/.test(
      String(error)
    )
  )
  assert.equal((await card(worker)).mergeRequestUpdated, false)
  await worker.deactivate()
})

test('when the merge request fetch fails after the target branch was fetched, Update workspace says so', async () => {
  const fakes = fakeDeps()
  const { worker } = await behind(fakes)
  fakes.git.failNextOf('fetchMergeRequestHead', new Error('git fetch of the MR failed: timeout'))

  await assert.rejects(worker.request('rr.updateWorkspace', { url: MR_URL }), (error) =>
    /fetched the target branch main, but fetching the merge request failed: git fetch of the MR failed: timeout\. The workspace wasn't changed\./.test(
      String(error)
    )
  )
  assert.deepEqual(fakes.git.resets, [])
  assert.equal((await card(worker)).mergeRequestUpdated, true)
  await worker.deactivate()
})

test('Update workspace runs the setup command again: the new head may change the dependencies', async () => {
  const fakes = fakeDeps()
  reviewingAtHead(fakes)
  const settings = { ...CONFIGURED, setupCommand: 'pnpm install' }
  const host = mockHost({
    settings,
    results: {
      'workspace.list': {
        workspaces: [{ id: 'ws-0', kind: 'worktree' as const, name: 'review-api-7', path: WORKTREE, branch: null, hostId: 'local' }],
        truncated: false
      },
      'workspace.open': { opened: true },
      'editor.open': { opened: true },
      'terminal.create': { terminalId: 'term-setup' }
    }
  })
  const { worker } = await startHarness(fakes, settings, host)
  fakes.gitlab.push('acme/api', 7)

  await worker.request('rr.updateWorkspace', { url: MR_URL })

  assert.deepEqual(host.callsOf('terminal.create'), [{ workspaceId: 'ws-0', title: 'Setup', command: 'pnpm install' }])
  await worker.deactivate()
})
