// Notifications for new and ended Review Requests (#23), through the worker's public surface: a
// configured worker over the fake GitLab and fake clock, observed through notifications.show.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import { GitLabError } from './seams/gitlab'
import { createWorker } from './worker'

const MINUTE = 60_000
const CONFIGURED = { instanceUrl: 'https://gitlab.example.com', pollMinutes: 5 }

type Note = { title: string; body?: string }

/** Starts a worker; `storage` carries what an earlier run of the worker left behind. */
async function startWorker(fakes: Fakes, storage: Record<string, unknown> = {}) {
  const host = mockHost({ settings: CONFIGURED, storage: storage as never })
  const worker = await mountWorker(createWorker(fakes.deps), { host })
  await fakes.clock.advance(0)
  return { host, worker, notes: () => host.callsOf('notifications.show') as Note[] }
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
    { title: 'New Review Request', body: '!3 Fix header\nacme/web · bob' },
    { title: 'New Review Request', body: '!7 Add login\nacme/api · ada' }
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

test('live poll: one notification per ended Review Request, saying why it ended', async () => {
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
      'Review Request ended: approved | !1 One\nacme/api',
      'Review Request ended: closed | !3 Three\nacme/api',
      'Review Request ended: merged | !2 Two\nacme/api',
      'Review Request ended: you were removed as Reviewer | !4 Four\nacme/api'
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

  assert.deepEqual(notes().slice(1), [{ title: 'Review Request made draft', body: '!1 One\nacme/api' }])
  await worker.deactivate()
})

test('a Review Request GitLab no longer shows the user (deleted, access lost) has ended', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.close('acme/api', 1)
  const rest = fakes.gitlab.rest.bind(fakes.gitlab)
  fakes.gitlab.rest = (method, path, body) =>
    path.includes('/merge_requests/')
      ? Promise.reject(new GitLabError('rejected', '404 Not found', { status: 404 }))
      : rest(method, path, body)
  await fakes.clock.advance(5 * MINUTE)

  assert.deepEqual(notes().slice(1), [{ title: 'Review Request ended', body: '!1 One\nacme/api' }])
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

  assert.deepEqual(notes(), [{ title: 'While you were away: 1 new, 1 ended', body: '!5 Came while away\nEnded: !2' }])
  await worker.deactivate()
})

test('catch-up says only what changed', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const stored = await runAndQuit(fakes)

  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Five' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 6, title: 'Six' })
  const { worker, notes } = await startWorker(fakes, stored)

  assert.deepEqual(notes(), [{ title: 'While you were away: 2 new', body: '!6 Six\n!5 Five' }])
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

  assert.deepEqual(notes().slice(1), [{ title: 'While you were away: 2 new', body: '!6 Six\n!5 Five' }])
  await worker.deactivate()
})

test('a short sleep is not a catch-up: still one notification per item', async () => {
  const fakes = fakeDeps()
  const { worker, notes } = await startWorker(fakes)

  fakes.clock.sleep(8 * MINUTE)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Five', author: 'ada' })
  await fakes.clock.advance(1 * MINUTE)

  assert.deepEqual(notes(), [{ title: 'New Review Request', body: '!5 Five\nacme/web · ada' }])
  await worker.deactivate()
})

test('failed polls notify nothing, and recovery after more than 2 intervals is a catch-up', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.merge('acme/api', 1)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 5, title: 'Five' })
  for (let i = 0; i < 2; i++) {
    fakes.gitlab.failNext(new GitLabError('transient', 'GitLab is down', { status: 503 }))
    await fakes.clock.advance(5 * MINUTE)
  }
  assert.equal(notes().length, 1)

  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(notes().slice(1), [{ title: 'While you were away: 1 new, 1 ended', body: '!5 Five\nEnded: !1' }])
  await worker.deactivate()
})

test('if GitLab cannot say why a Review Request dropped off, it asks again on the next poll', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'One' })
  const { worker, notes } = await startWorker(fakes)

  fakes.gitlab.merge('acme/api', 1)
  const rest = fakes.gitlab.rest.bind(fakes.gitlab)
  let lookups = 0
  fakes.gitlab.rest = (method, path, body) => {
    if (path.includes('/merge_requests/') && ++lookups === 1) {
      return Promise.reject(new GitLabError('transient', 'GitLab is down', { status: 503 }))
    }
    return rest(method, path, body)
  }
  await fakes.clock.advance(5 * MINUTE)
  assert.equal(notes().length, 1)

  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(notes().slice(1), [{ title: 'Review Request ended: merged', body: '!1 One\nacme/api' }])
  await worker.deactivate()
})
