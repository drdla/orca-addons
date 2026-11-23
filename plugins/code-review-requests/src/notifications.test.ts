// Notifications for new and ended Review Requests (#23), through the worker's public surface: a
// configured worker over the fake GitLab and fake clock, observed through notifications.show.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps, FakeGitLab, type Fakes } from './fakes'
import { GitLabError } from './seams/gitlab'
import { CONFIGURED, lastStatusBar, MINUTE, startWorker as startHarness } from './testing/worker-harness'

type Note = { title: string; body?: string }

/** Starts a worker; `storage` carries what an earlier run of the worker left behind. */
async function startWorker(fakes: Fakes, storage: Record<string, unknown> = {}) {
  const started = await startHarness(fakes, CONFIGURED, mockHost({ settings: CONFIGURED, storage: storage as never }))
  return { ...started, notes: () => started.host.callsOf('notifications.show') as Note[] }
}

test('first run: one summary of what is already waiting', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 3, title: 'Fix header' })

  const { worker, notes } = await startWorker(fakes)

  assert.equal(notes().length, 1)
  assert.equal(notes()[0]!.title, '2 Review Requests waiting')
  assert.match(notes()[0]!.body ?? '', /Add login/)
  assert.match(notes()[0]!.body ?? '', /Fix header/)
  await worker.deactivate()
})

test('first run with nothing waiting sends nothing', async () => {
  const fakes = fakeDeps()
  const { worker, notes } = await startWorker(fakes)

  assert.deepEqual(notes(), [])
  await worker.deactivate()
})

test('a first-run summary lists the top 3 and counts the rest', async () => {
  const fakes = fakeDeps()
  for (let i = 1; i <= 5; i++) fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: i, title: `MR ${i}` })

  const { worker, notes } = await startWorker(fakes)

  assert.equal(notes()[0]!.title, '5 Review Requests waiting')
  assert.equal(notes()[0]!.body?.split('\n').length, 4)
  assert.match(notes()[0]!.body ?? '', /\+2 more$/)
  await worker.deactivate()
})

test('live poll: one notification per new Review Request', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1 })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login', author: 'ada' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 3, title: 'Fix header', author: 'bob' })
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(notes().slice(1), [
    { title: 'bob asked you to review Fix header', body: 'acme/web !3' },
    { title: 'ada asked you to review Add login', body: 'acme/api !7' }
  ])
  await worker.deactivate()
})

test('live poll: nothing changed, nothing sent', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1 })
  const { worker, notes } = await startWorker(fakes)

  await fakes.clock.advance(5 * MINUTE)
  await fakes.clock.advance(5 * MINUTE)

  assert.equal(notes().length, 1)
  await worker.deactivate()
})

test('live poll: requesting changes ends a Review Request silently, like approving (#78)', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 2, title: 'Two' })
  const { worker, notes, host } = await startWorker(fakes)

  fakes.gitlab.setReviewState('acme/api', 1, 'REQUESTED_CHANGES')
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(notes().slice(1), [], 'no notification for my own request for changes')
  assert.equal(lastStatusBar(host)?.text, '1')
  await worker.deactivate()
})

test('live poll: one notification per ended Review Request, saying why it ended; none for my own approval', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 2, title: 'Two' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 3, title: 'Three' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 4, title: 'Four' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.approve('acme/api', 1)
  fakes.gitlab.merge('acme/api', 2)
  fakes.gitlab.close('acme/api', 3)
  fakes.gitlab.removeReviewer('acme/api', 4, 'me')
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(
    notes()
      .slice(1)
      .map((n) => `${n.title} | ${n.body}`)
      .sort(),
    [
      'Three was closed | acme/api !3',
      'Two was merged | acme/api !2',
      'You were removed as reviewer of Four | acme/api !4'
    ]
  )
  await worker.deactivate()
})

test('live poll: a Review Request made draft notifies, but not as ended', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.markDraft('acme/api', 1)
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(notes().slice(1), [{ title: 'One was made a draft', body: 'acme/api !1' }])
  await worker.deactivate()
})

test('the reason a Review Request ended comes from one GraphQL query, not a REST lookup', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.merge('acme/api', 1)
  await fakes.clock.advance(5 * MINUTE)

  const operations = fakes.gitlab.requests.map((r) => r.operation)
  assert.ok(operations.includes('graphql DroppedMergeRequest'))
  assert.ok(!operations.some((o) => /^GET \/projects\/[^/]+\/merge_requests\/1$/.test(o)), 'no REST lookup')
  assert.equal(notes().at(-1)?.title, 'One was merged')
  await worker.deactivate()
})

test('a Review Request GitLab no longer shows the user is not Ended: one neutral notification', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.close('acme/api', 1)
  fakes.gitlab.hide('acme/api', 1)
  await fakes.clock.advance(5 * MINUTE)
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(notes().slice(1), [{ title: 'One is no longer visible to you', body: 'acme/api !1' }])
  await worker.deactivate()
})

test('a 403 or 404 on the lookup means "no longer visible", not Ended', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.close('acme/api', 1)
  const graphql = fakes.gitlab.graphql.bind(fakes.gitlab)
  fakes.gitlab.graphql = (query, variables) =>
    query.includes('DroppedMergeRequest')
      ? Promise.reject(new GitLabError('rejected', '403 Forbidden', { status: 403 }))
      : graphql(query, variables)
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(notes().slice(1), [{ title: 'One is no longer visible to you', body: 'acme/api !1' }])
  await worker.deactivate()
})

test('first run: the summary counts the overdue Review Requests', async () => {
  const fakes = fakeDeps()
  const now = fakes.clock.now()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Old', requestedAt: now - 10 * 24 * 60 * MINUTE })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 3, title: 'Recent', requestedAt: now - MINUTE })

  const { worker, notes } = await startWorker(fakes)

  assert.equal(notes()[0]!.title, '2 Review Requests waiting')
  assert.match(notes()[0]!.body ?? '', /^1 overdue\./)
  await worker.deactivate()
})

test("changing the instance URL never ends the old host's Review Requests: it is a first run there", async () => {
  const fakes = fakeDeps()
  const other = new FakeGitLab({ clock: fakes.clock, host: 'gitlab.other.com' })
  const gitLab = fakes.deps.gitLab
  fakes.deps.gitLab = (connection) => (connection.host === 'gitlab.other.com' ? other : gitLab(connection))
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'Old host' })
  other.addMergeRequest({ projectPath: 'beta/app', iid: 2, title: 'New host' })
  const { worker, notes, changeSetting } = await startWorker(fakes)

  await changeSetting('instanceUrl', 'https://gitlab.other.com')
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(notes().slice(1), [{ title: '1 Review Request waiting', body: 'author asked you to review New host' }])
  assert.ok(!other.requests.some((r) => r.operation === 'graphql DroppedMergeRequest'), 'no old-host lookup')
  assert.equal((await worker.request('rr.snapshot')).ended, undefined)
  await worker.deactivate()
})

/** Runs a worker to its first poll and stops it, as when Orca quits; returns what it stored. */
async function runAndQuit(fakes: Fakes) {
  const { host, worker } = await startWorker(fakes)
  await worker.deactivate()
  return host.data().storage as Record<string, unknown>
}

test('catch-up after a restart: one summary of what changed while away', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'Stays' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 2, title: 'Gets merged' })
  const stored = await runAndQuit(fakes)

  fakes.clock.sleep(3 * 60 * MINUTE)
  fakes.gitlab.merge('acme/api', 2)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Came while away' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 6, title: 'Came and went' })
  fakes.gitlab.close('acme/web', 6)
  const { worker, notes } = await startWorker(fakes, stored)

  assert.deepEqual(notes(), [{ title: 'While you were away: 1 new, 1 ended', body: 'author asked you to review Came while away\nGets merged was merged' }])
  await worker.deactivate()
})

test('catch-up says only what changed', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const stored = await runAndQuit(fakes)

  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Five' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 6, title: 'Six' })
  const { worker, notes } = await startWorker(fakes, stored)

  assert.deepEqual(notes(), [{ title: 'While you were away: 2 new', body: 'author asked you to review Six\nauthor asked you to review Five' }])
  await worker.deactivate()
})

test('catch-up with nothing changed sends nothing', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1 })
  const stored = await runAndQuit(fakes)

  const { worker, notes } = await startWorker(fakes, stored)

  assert.deepEqual(notes(), [])
  await worker.deactivate()
})

test('catch-up after the Mac slept through more than 2 intervals', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.clock.sleep(11 * MINUTE)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Five' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 6, title: 'Six' })
  await fakes.clock.advance(1 * MINUTE)

  assert.deepEqual(notes().slice(1), [{ title: 'While you were away: 2 new', body: 'author asked you to review Six\nauthor asked you to review Five' }])
  await worker.deactivate()
})

test('a short sleep is not a catch-up: still one notification per item', async () => {
  const fakes = fakeDeps()
  const { worker, notes } = await startWorker(fakes)

  fakes.clock.sleep(8 * MINUTE)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Five', author: 'ada' })
  await fakes.clock.advance(1 * MINUTE)

  assert.deepEqual(notes(), [{ title: 'ada asked you to review Five', body: 'acme/web !5' }])
  await worker.deactivate()
})

test('failed polls notify nothing, and recovery after more than 2 intervals is a catch-up', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.merge('acme/api', 1)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Five' })
  // Polls fail at 5, 6, 8 and 12 minutes (transient backoff, #24); the one at 17 works.
  for (let i = 0; i < 4; i++) fakes.gitlab.failNext(new GitLabError('transient', 'GitLab is down', { status: 503 }))
  await fakes.clock.advance(12 * MINUTE)
  assert.equal(notes().length, 1)

  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(notes().slice(1), [{ title: 'While you were away: 1 new, 1 ended', body: 'author asked you to review Five\nOne was merged' }])
  await worker.deactivate()
})

test('if GitLab cannot say why a Review Request dropped off, it asks again on the next poll', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.merge('acme/api', 1)
  const graphql = fakes.gitlab.graphql.bind(fakes.gitlab)
  let lookups = 0
  fakes.gitlab.graphql = (query, variables) => {
    if (query.includes('DroppedMergeRequest') && ++lookups === 1) {
      return Promise.reject(new GitLabError('transient', 'GitLab is down', { status: 503 }))
    }
    return graphql(query, variables)
  }
  await fakes.clock.advance(5 * MINUTE)
  assert.equal(notes().length, 1)

  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(notes().slice(1), [{ title: 'One was merged', body: 'acme/api !1' }])
  await worker.deactivate()
})
