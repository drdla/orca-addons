// What each card carries beyond the Review Request itself (#10): CI, approvals and comment
// badges, the New mark (appeared since the panel was last opened, per host) and the status bar item's
// "M new", and the Agent Review line on In review cards. Through the worker's public surface.
import { assert, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import { GitLabError } from './seams/gitlab'
import { CONFIGURED, lastStatusBar, MINUTE, startWorker } from './testing/worker-harness'

const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'

async function cardOf(worker: Awaited<ReturnType<typeof startWorker>>['worker'], iid: number) {
  return (await worker.request('rr.snapshot')).reviewRequests.find((c) => c.iid === iid)
}

test('cards carry the CI status, approvals given/required and the open comment count, leaving resolved threads out', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({
    projectPath: 'acme/api',
    iid: 1,
    pipeline: 'FAILED',
    approvalsRequired: 2,
    approvedBy: ['ada'],
    openThreads: 3,
    resolvedThreads: 4
  })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 2, pipeline: 'RUNNING' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 3, pipeline: 'SUCCESS' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 4 })
  const { worker } = await startWorker(fakes)

  const one = await cardOf(worker, 1)
  assert.equal(one?.ci, 'failed')
  assert.deepEqual(one?.approvals, { given: 1, required: 2 })
  assert.equal(one?.comments, 3)
  assert.equal((await cardOf(worker, 2))?.ci, 'running')
  assert.equal((await cardOf(worker, 3))?.ci, 'passed')
  const four = await cardOf(worker, 4)
  assert.equal(four?.ci, null, 'no pipeline, no CI badge')
  assert.equal(four?.approvals, null, 'no approvals required, no approvals badge')
  assert.equal(four?.comments, 0)
  await worker.deactivate()
})

test('on GitLab CE (no approval fields) the list still loads; only the approvals badge is hidden', async () => {
  const fakes = fakeDeps({ gitlab: { edition: 'ce' } })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, pipeline: 'SUCCESS', openThreads: 2, approvalsRequired: 2 })
  const { worker, host } = await startWorker(fakes)
  await fakes.clock.advance(5 * MINUTE)

  const snapshot = await worker.request('rr.snapshot')
  assert.equal(snapshot.gitlab, undefined, 'no setup or retry state')
  const one = snapshot.reviewRequests.find((c) => c.iid === 1)
  assert.equal(one?.ci, 'passed')
  assert.equal(one?.comments, 2)
  assert.equal(one?.approvals, null)
  assert.equal(lastStatusBar(host)?.text, '1')
  const asked = fakes.gitlab.requests.filter((r) => r.operation === 'graphql ReviewRequestApprovals').length
  assert.equal(asked, 1, 'a refused approvals query is not asked again')
  await worker.deactivate()
})

test('a failing approvals query never fails the poll', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, approvalsRequired: 1 })
  const graphql = fakes.gitlab.graphql.bind(fakes.gitlab)
  fakes.gitlab.graphql = (query, variables) =>
    query.includes('ReviewRequestApprovals')
      ? Promise.reject(new GitLabError('transient', '503 Service Unavailable', { status: 503 }))
      : graphql(query, variables)
  const { worker } = await startWorker(fakes)

  const snapshot = await worker.request('rr.snapshot')
  assert.equal(snapshot.gitlab, undefined)
  assert.equal(snapshot.reviewRequests[0]?.approvals, null)
  await worker.deactivate()
})

test('nothing is New on the first run; what appears later is New until the panel is opened again', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1 })
  const { worker, host } = await startWorker(fakes)
  assert.equal((await cardOf(worker, 1))?.isNew, false)

  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 2 })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 3 })
  await fakes.clock.advance(5 * MINUTE)
  assert.equal((await cardOf(worker, 2))?.isNew, true)
  assert.equal(lastStatusBar(host)?.tooltip, '3 Review Requests, 2 new. Click to open.')

  await worker.request('rr.markSeen')
  assert.equal((await cardOf(worker, 2))?.isNew, true, 'still marked while this panel is open')
  assert.equal(lastStatusBar(host)?.tooltip, '3 Review Requests. Click to open.', 'the status bar item counts it seen')

  await worker.request('rr.markSeen')
  assert.equal((await cardOf(worker, 2))?.isNew, false, 'seen at the next opening')
  await worker.deactivate()
})

test('what was seen survives a restart', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1 })
  const first = await startWorker(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 2 })
  await fakes.clock.advance(5 * MINUTE)
  await first.worker.deactivate()

  const second = await startWorker(fakes, CONFIGURED, first.host)
  assert.equal((await cardOf(second.worker, 2))?.isNew, true)
  await second.worker.deactivate()
})

/** !7 with a Review Workspace, whose agents and Review Draft the tests set. */
function arrangeInReview(fakes: Fakes) {
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7 })
  fakes.cli.addRepo({ repoId: 'repo-api', projectId: 'git:gitlab.example.com/acme/api', path: '/src/api' })
  return fakes.cli.addWorktree({ name: 'review-api-7', repoId: 'repo-api', path: '/wt/review-api-7', references: [MR_URL] })
}

test('an In review card says when its Agent Review is running', async () => {
  const fakes = fakeDeps()
  const worktree = arrangeInReview(fakes)
  fakes.cli.setAgents(worktree.id, ['working'])
  const { worker } = await startWorker(fakes)

  assert.deepEqual((await cardOf(worker, 7))?.agentReview, { state: 'running', commentsReady: 0 })
  await worker.deactivate()
})

test('a done Agent Review says how many Review Comments are ready, and the card how many post', async () => {
  const fakes = fakeDeps()
  const worktree = arrangeInReview(fakes)
  fakes.cli.setAgents(worktree.id, ['done'])
  fakes.cli.setDiffComments(worktree.id, [
    { id: 'n1', worktreeId: worktree.id, filePath: 'src/a.ts', lineNumber: 3, body: 'One', createdAt: 1, scope: 'branch', side: 'modified' },
    { id: 'n2', worktreeId: worktree.id, filePath: 'src/a.ts', lineNumber: 5, body: 'Two', createdAt: 1, scope: 'branch', side: 'modified' }
  ])
  const { worker } = await startWorker(fakes)
  await worker.request('rr.draft', { url: MR_URL })
  await fakes.clock.advance(5 * MINUTE)

  const card = await cardOf(worker, 7)
  assert.deepEqual(card?.agentReview, { state: 'done', commentsReady: 2 })
  assert.equal(card?.toPost, 2)
  await worker.deactivate()
})

test('no agent in the Review Workspace, no Agent Review line; a card without one has neither', async () => {
  const fakes = fakeDeps()
  arrangeInReview(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 8 })
  const { worker } = await startWorker(fakes)

  assert.equal((await cardOf(worker, 7))?.agentReview, null)
  assert.equal((await cardOf(worker, 8))?.agentReview, null)
  assert.equal((await cardOf(worker, 8))?.toPost, 0)
  await worker.deactivate()
})

test('a failing `orca worktree ps` only drops the Agent Review line', async () => {
  const fakes = fakeDeps()
  const worktree = arrangeInReview(fakes)
  fakes.cli.setAgents(worktree.id, ['working'])
  fakes.cli.failAgents = true
  const { worker } = await startWorker(fakes)

  const card = await cardOf(worker, 7)
  assert.equal(card?.workspace?.id, worktree.id)
  assert.equal(card?.agentReview, null)
  await worker.deactivate()
})
