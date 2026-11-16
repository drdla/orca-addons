// The worker side of the To review tab (#22): what rr.snapshot tells the panel about waiting
// time, order and overdue, and the overdue bell, through the worker's public surface.
import { assert, test } from 'orca/testing'
import { fakeDeps } from './fakes'
import { GitLabError } from './seams/gitlab'
import { CONFIGURED, lastStatusBar, MINUTE, startWorker } from './testing/worker-harness'

const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// The fake clock starts on Monday 2026-11-16, 09:00 UTC. Tuesday-to-Monday spans are 4 working
// days in any time zone, and an hour ago is never overdue.

test('lists Review Requests longest waiting first, by when the user was added as Reviewer', async () => {
  const fakes = fakeDeps()
  const now = fakes.clock.now()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'Recent', requestedAt: now - HOUR })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 2, title: 'Oldest', requestedAt: now - 6 * DAY })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 3, title: 'Middle', requestedAt: now - 2 * HOUR })

  const { worker } = await startWorker(fakes)
  const snapshot = await worker.request('rr.snapshot')

  assert.deepEqual(
    snapshot.reviewRequests.map((r) => [r.title, r.requestedAt]),
    [
      ['Oldest', now - 6 * DAY],
      ['Middle', now - 2 * HOUR],
      ['Recent', now - HOUR]
    ]
  )
  await worker.deactivate()
})

test('marks Review Requests past the overdue threshold, counting working days only', async () => {
  const fakes = fakeDeps()
  const now = fakes.clock.now()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', title: 'Six days', requestedAt: now - 6 * DAY })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', title: 'An hour', requestedAt: now - HOUR })

  const { worker } = await startWorker(fakes)
  const snapshot = await worker.request('rr.snapshot')

  assert.deepEqual(
    snapshot.reviewRequests.map((r) => [r.title, r.overdue]),
    [
      ['Six days', true],
      ['An hour', false]
    ]
  )
  await worker.deactivate()
})

test('the overdue threshold follows the "Overdue after" setting', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', requestedAt: fakes.clock.now() - 2 * HOUR })

  const { worker } = await startWorker(fakes, { ...CONFIGURED, overdueHours: 1 })
  const [only] = (await worker.request('rr.snapshot')).reviewRequests

  assert.equal(only?.overdue, true)
  await worker.deactivate()
})

test('asks GitLab when the user was added only once per Review Request', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 4 })
  const { worker } = await startWorker(fakes)

  await worker.command('code-review-requests.refresh')
  await worker.command('code-review-requests.refresh')

  const asked = fakes.gitlab.requests.filter((r) => r.operation.endsWith('/reviewers'))
  assert.deepEqual(asked.map((r) => r.operation), ['GET /projects/acme%2Fapi/merge_requests/4/reviewers'])
  await worker.deactivate()
})

test('falls back to when the merge request was opened if GitLab cannot say, and asks again later', async () => {
  const failing = fakeDeps()
  const opened = failing.clock.now()
  failing.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 4, requestedAt: opened + MINUTE })
  const rest = failing.gitlab.rest.bind(failing.gitlab)
  let fail = true
  failing.gitlab.rest = (method, path, body) =>
    fail && path.endsWith('/reviewers')
      ? Promise.reject(new GitLabError('transient', 'GitLab is down', { status: 503 }))
      : rest(method, path, body)

  const second = await startWorker(failing)
  assert.equal((await second.worker.request('rr.snapshot')).reviewRequests[0]?.requestedAt, opened)

  fail = false
  await second.worker.command('code-review-requests.refresh')
  assert.equal((await second.worker.request('rr.snapshot')).reviewRequests[0]?.requestedAt, opened + MINUTE)
  await second.worker.deactivate()
})

test('the bell turns danger and the tooltip counts overdue Review Requests', async () => {
  const fakes = fakeDeps()
  const now = fakes.clock.now()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', requestedAt: now - 6 * DAY })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', requestedAt: now - HOUR })

  const { host, worker } = await startWorker(fakes)

  assert.equal(lastStatusBar(host)?.tone, 'danger')
  assert.equal(lastStatusBar(host)?.tooltip, '2 Review Requests, 1 overdue. Click to open.')
  await worker.deactivate()
})

test('the bell keeps its warning tone while nothing is overdue', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', requestedAt: fakes.clock.now() - HOUR })

  const { host, worker } = await startWorker(fakes)

  assert.equal(lastStatusBar(host)?.tone, 'warning')
  assert.equal(lastStatusBar(host)?.tooltip, '1 Review Request. Click to open.')
  await worker.deactivate()
})

test('after each poll, the worker pushes the new snapshot to open panels', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', title: 'Add login' })

  await fakes.clock.advance(5 * MINUTE)

  const pushed = worker.posts.filter((p) => p.event === 'rr.changed').at(-1)
  assert.deepEqual(
    (pushed?.payload as { reviewRequests: { title: string }[] }).reviewRequests.map((r) => r.title),
    ['Add login']
  )
  await worker.deactivate()
})

test('the panel can ask for a refresh and gets the new snapshot back', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', title: 'Add login' })

  const snapshot = await worker.request('rr.refresh')

  assert.deepEqual(snapshot.reviewRequests.map((r) => r.title), ['Add login'])
  assert.equal(snapshot.refreshedAt, fakes.clock.now())
  await worker.deactivate()
})

test('copying a link puts the Review Request URL on the clipboard', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)

  const answer = await worker.request('rr.copyLink', { url: 'https://gitlab.example.com/acme/api/-/merge_requests/7' })

  assert.deepEqual(answer, { copied: true })
  assert.deepEqual(fakes.desktop.clipboard, ['https://gitlab.example.com/acme/api/-/merge_requests/7'])
  await worker.deactivate()
})

test('pressing the bell opens the Review Requests panel', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)

  await worker.command('code-review-requests.open')

  assert.deepEqual(fakes.desktop.openedPanels, ['review-requests'])
  await worker.deactivate()
})
