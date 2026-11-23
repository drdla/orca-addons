// A re-requested review goes back to Todo (#79), end to end through the worker: after the user
// approved, requested changes or commented, the author's re-request lists it again as
// re-requested (with what the user did before), notifies, and Start review reuses its old Review
// Workspace, moved to the new commits. GitLab, the orca CLI, git and the clock are fakes.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import type { Note } from './notify/notes'
import { CONFIGURED, MINUTE, startWorker as startHarness } from './testing/worker-harness'

const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const REPO = { repoId: 'repo-api', projectId: 'git:gitlab.example.com/acme/api', path: '/src/api' }
const WORKTREE = '/wt/review-api-7'
const MR_HEAD_REF = 'refs/remotes/origin/merge-requests/7'

function hostOf(storage: Record<string, unknown> = {}, settings: Record<string, string | number> = {}) {
  return mockHost({
    settings: { ...CONFIGURED, ...settings },
    storage: storage as never,
    results: {
      'workspace.list': {
        workspaces: [{ id: 'ws-0', kind: 'worktree' as const, name: 'review-api-7', path: WORKTREE, branch: null, hostId: 'local' }],
        truncated: false
      },
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
}

async function startWorker(fakes: Fakes, host = hostOf()) {
  const started = await startHarness(fakes, CONFIGURED, host)
  return { ...started, notes: () => started.host.callsOf('notifications.show') as Note[] }
}

/** MR !7 by Ada; with a Review Workspace at its head unless `workspace` is false. */
function arrange(fakes: Fakes, workspace = true) {
  const mr = fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login', author: 'ada', targetBranch: 'main' })
  fakes.cli.addRepo(REPO)
  if (workspace) {
    fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WORKTREE, references: [MR_URL] })
    fakes.git.setHead(WORKTREE, mr.diffRefs.headSha)
    fakes.git.setRef(WORKTREE, MR_HEAD_REF, mr.diffRefs.headSha)
  }
  return mr
}

async function cardOf(worker: Awaited<ReturnType<typeof startWorker>>['worker']) {
  return (await worker.request('rr.snapshot')).reviewRequests.find((c) => c.url === MR_URL)
}

const tick = (fakes: Fakes) => fakes.clock.advance(5 * MINUTE)

test('approve, then re-request: the card leaves Done for Todo, re-requested after an approval, with its workspace', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const { worker, notes } = await startWorker(fakes)
  const requestedAt = (await cardOf(worker))!.requestedAt

  fakes.gitlab.approve('acme/api', 7)
  await tick(fakes)
  assert.deepEqual((await worker.request('rr.snapshot')).ended?.map((e) => e.reason), ['approved'])

  fakes.gitlab.reRequestReview('acme/api', 7)
  await tick(fakes)

  const snapshot = await worker.request('rr.snapshot')
  assert.equal(snapshot.ended, undefined, 'no longer Done')
  const card = (await cardOf(worker))!
  assert.equal(card.reRequested, 'approved')
  assert.equal(card.workspace?.path, WORKTREE, 'its old workspace is still attached')
  assert.equal(card.isNew, false, 'Re-requested, not New')
  assert.equal(card.requestedAt, requestedAt, 'the overdue clock does not restart')
  assert.deepEqual(
    notes().slice(1).map((n) => `${n.title} | ${n.body}`),
    ['ada re-requested your review of Add login | acme/api !7'],
    'one notification, worded as a re-request; none for the approval'
  )
  await worker.deactivate()
})

test('request changes, then re-request: re-requested after a request for changes', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const { worker } = await startWorker(fakes)

  fakes.gitlab.setReviewState('acme/api', 7, 'REQUESTED_CHANGES')
  await tick(fakes)
  fakes.gitlab.reRequestReview('acme/api', 7)
  await tick(fakes)

  assert.equal((await cardOf(worker))?.reRequested, 'changes-requested')
  await worker.deactivate()
})

test('comment, then re-request: the card goes from Reviewing back to Todo, re-requested after a comment', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.setReviewState('acme/api', 7, 'REVIEWED')
  await tick(fakes)
  assert.equal((await cardOf(worker))?.reRequested, null, 'a comment alone keeps it under Reviewing')

  fakes.gitlab.reRequestReview('acme/api', 7)
  await tick(fakes)

  assert.equal((await cardOf(worker))?.reRequested, 'commented')
  assert.deepEqual(notes().slice(1).map((n) => n.title), ['ada re-requested your review of Add login'])
  await tick(fakes)
  assert.equal(notes().length, 2, 'notified once')
  await worker.deactivate()
})

test('without a workspace (approved on gitlab.com), a re-request still says what the user did before', async () => {
  const fakes = fakeDeps()
  arrange(fakes, false)
  const { worker } = await startWorker(fakes)

  fakes.gitlab.approve('acme/api', 7)
  await tick(fakes)
  fakes.gitlab.reRequestReview('acme/api', 7)
  await tick(fakes)

  const card = (await cardOf(worker))!
  assert.equal(card.reRequested, 'approved')
  assert.equal(card.workspace, null)
  await worker.deactivate()
})

test('the last outcome is kept across restarts', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const first = await startWorker(fakes)
  fakes.gitlab.approve('acme/api', 7)
  await tick(fakes)
  await first.worker.deactivate()

  const { worker } = await startWorker(fakes, hostOf(first.host.data().storage))
  fakes.gitlab.reRequestReview('acme/api', 7)
  await tick(fakes)

  assert.equal((await cardOf(worker))?.reRequested, 'approved')
  await worker.deactivate()
})

test('Start review on a re-requested card reuses its workspace, moved to the new commits, with an Agent Review; then it is under Reviewing', async () => {
  const fakes = fakeDeps()
  const mr = arrange(fakes)
  const { worker } = await startWorker(fakes, hostOf({}, { reviewPrompt: 'Review {mrUrl}' }))
  fakes.gitlab.approve('acme/api', 7)
  await tick(fakes)
  fakes.gitlab.reRequestReview('acme/api', 7)
  fakes.gitlab.push('acme/api', 7)
  await tick(fakes)
  fakes.git.setRemoteMergeRequestHead(7, mr.diffRefs.headSha)
  assert.equal((await cardOf(worker))?.mergeRequestUpdated, true)

  const snapshot = await worker.request('rr.startReview', { url: MR_URL, withAgent: true })

  assert.deepEqual(fakes.git.resets, [{ worktreePath: WORKTREE, ref: MR_HEAD_REF }], 'moved to the new head')
  assert.equal(fakes.cli.calls.filter((c) => c.command === 'worktree create').length, 0, 'no second workspace')
  assert.equal(fakes.cli.calls.filter((c) => c.command === 'agent launch').length, 1, 'an Agent Review')
  const card = snapshot.reviewRequests.find((c) => c.url === MR_URL)!
  assert.equal(card.reRequested, null, 'under Reviewing again')
  assert.equal(card.mergeRequestUpdated, false)

  await tick(fakes)
  assert.equal((await cardOf(worker))?.reRequested, null, 'still awaiting the review, but not re-requested again')
  await worker.deactivate()
})

test('Start review on a re-requested card whose workspace has uncommitted changes refuses and keeps it re-requested', async () => {
  const fakes = fakeDeps()
  const mr = arrange(fakes)
  const { worker } = await startWorker(fakes)
  fakes.gitlab.approve('acme/api', 7)
  await tick(fakes)
  fakes.gitlab.reRequestReview('acme/api', 7)
  fakes.gitlab.push('acme/api', 7)
  await tick(fakes)
  fakes.git.setRemoteMergeRequestHead(7, mr.diffRefs.headSha)
  fakes.git.setStatus(WORKTREE, [' M src/login.ts'])

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: false }), /uncommitted change/)

  assert.deepEqual(fakes.git.resets, [])
  assert.equal((await cardOf(worker))?.reRequested, 'approved')
  await worker.deactivate()
})

test('a merged merge request forgets the last outcome, looked up at most hourly while it is off the list', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const { worker, host } = await startWorker(fakes)
  fakes.gitlab.approve('acme/api', 7)
  await tick(fakes)
  assert.ok(JSON.stringify(host.data().storage['review.rounds']).includes(MR_URL))
  const lookups = () => fakes.gitlab.requests.filter((r) => r.operation === 'graphql DroppedMergeRequest').length
  const before = lookups()

  fakes.gitlab.merge('acme/api', 7)
  await tick(fakes)
  assert.equal(lookups(), before, 'not again within the hour')
  assert.ok(JSON.stringify(host.data().storage['review.rounds']).includes(MR_URL))

  await fakes.clock.advance(60 * MINUTE)

  assert.deepEqual(host.data().storage['review.rounds'] ?? {}, {})
  await worker.deactivate()
})
