// The poll loop end to end, through the worker's public surface: a configured worker over the
// fake GitLab and fake clock, observed through the status bar, its commands and rr.snapshot.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { fakeDeps, type Fakes } from './fakes'
import { GitLabError } from './seams/gitlab'
import { createWorker } from './worker'

const MINUTE = 60_000

/** Settings as real Orca hands them over: with the declared defaults filled in. */
const CONFIGURED = { instanceUrl: 'https://gitlab.example.com', pollMinutes: 5 }

async function startWorker(fakes: Fakes, settings: Record<string, string | number> = CONFIGURED) {
  const host = mockHost({ settings })
  const worker = await mountWorker(createWorker(fakes.deps), { host })
  await fakes.clock.advance(0)
  return { host, worker }
}

type StatusBarUpdate = { id: string; text?: string; visible?: boolean; icon?: string; tone?: string; tooltip?: string }

function lastStatusBar(host: ReturnType<typeof mockHost>): StatusBarUpdate | undefined {
  return host.callsOf('statusBar.update').at(-1) as StatusBarUpdate | undefined
}

test('a configured worker polls GitLab at once and shows the count on the bell', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', title: 'Add login' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web' })

  const { host, worker } = await startWorker(fakes)

  const bar = lastStatusBar(host)
  assert.equal(bar?.id, 'review-requests')
  assert.equal(bar?.text, '2')
  assert.equal(bar?.icon, 'bell')
  assert.equal(bar?.visible, true)
  assert.match(bar?.tooltip ?? '', /2 Review Requests/)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

function reviewRequestPolls(fakes: Fakes): number {
  return fakes.gitlab.requests.filter((r) => r.operation === 'graphql ReviewRequests').length
}

test('the bell is hidden while there is nothing to review', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startWorker(fakes)

  assert.equal(reviewRequestPolls(fakes), 1)
  assert.equal(lastStatusBar(host)?.visible, false)
  await worker.deactivate()
})

test('polls again once the interval has passed, and not before', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startWorker(fakes, { ...CONFIGURED, pollMinutes: 10 })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })

  await fakes.clock.advance(9 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 1)
  assert.equal(lastStatusBar(host)?.visible, false)

  await fakes.clock.advance(1 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 2)
  assert.equal(lastStatusBar(host)?.text, '1')
  assert.equal(lastStatusBar(host)?.visible, true)
  await worker.deactivate()
})

test('uses the default interval of 5 minutes when none is set', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes, { instanceUrl: CONFIGURED.instanceUrl })

  await fakes.clock.advance(5 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 2)
  await worker.deactivate()
})

test('after the Mac sleeps through a due poll, it polls on the first tick after waking', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)

  fakes.clock.sleep(60 * MINUTE)
  await fakes.clock.advance(1 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 2)
  await worker.deactivate()
})

test('the refresh command polls at once and says what it found', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startWorker(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })

  assert.equal(await worker.command('code-review-requests.refresh'), '1 Review Request.')
  assert.equal(reviewRequestPolls(fakes), 2)
  assert.equal(lastStatusBar(host)?.text, '1')

  // The schedule restarts from the manual poll.
  await fakes.clock.advance(4 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 2)
  await fakes.clock.advance(1 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 3)
  await worker.deactivate()
})

test('the refresh command does nothing until GitLab is configured', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes, {})

  assert.equal(await worker.command('code-review-requests.refresh'), 'GitLab is not set up yet.')
  assert.deepEqual(fakes.gitlab.requests, [])
  await worker.deactivate()
})

test('a failed poll keeps the last list and the bell', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', title: 'Add login' })
  const { host, worker } = await startWorker(fakes)

  fakes.gitlab.failNext(new GitLabError('transient', 'GitLab is down', { status: 503 }))
  assert.match(String(await worker.command('code-review-requests.refresh')), /GitLab is down/)

  assert.equal(lastStatusBar(host)?.text, '1')
  assert.equal(lastStatusBar(host)?.visible, true)
  const snapshot = await worker.request('rr.snapshot')
  assert.deepEqual(
    snapshot.reviewRequests.map((r) => r.title),
    ['Add login']
  )
  await worker.deactivate()
})

test('the panel snapshot lists the Review Requests from the last poll', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login', author: 'ada' })
  const { worker } = await startWorker(fakes)

  assert.deepEqual(await worker.request('rr.snapshot'), {
    reviewRequests: [
      {
        url: 'https://gitlab.example.com/acme/api/-/merge_requests/7',
        title: 'Add login',
        projectPath: 'acme/api',
        iid: 7,
        author: 'ada',
        requestedAt: fakes.clock.now(),
        overdue: false
      }
    ],
    refreshedAt: fakes.clock.now()
  })
  await worker.deactivate()
})

test('asks GitLab who the user is once, and polls the configured instance through glab', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes, { ...CONFIGURED, instanceUrl: 'https://gitlab.acme.dev/' })
  await worker.command('code-review-requests.refresh')

  assert.deepEqual(fakes.connections, [{ host: 'gitlab.acme.dev', token: null }])
  assert.equal(fakes.gitlab.requests.filter((r) => r.operation === 'GET /user').length, 1)
  assert.deepEqual(
    fakes.gitlab.requests.filter((r) => r.operation.startsWith('graphql')).map((r) => r.variables?.me),
    ['me', 'me']
  )
  await worker.deactivate()
})

test('does not count a Review Request the user approved, even if GitLab still lists it', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', approvedBy: ['me'] })
  const listed = fakes.gitlab.graphql.bind(fakes.gitlab)
  // An instance where the experimental `not: { approvedBy }` filter is ignored.
  fakes.gitlab.graphql = (query, variables) => listed(query, { ...variables, me: 'nobody' })

  const { host, worker } = await startWorker(fakes)
  assert.equal(lastStatusBar(host)?.text, '1')
  await worker.deactivate()
})

test('follows every page of Review Requests', async () => {
  const fakes = fakeDeps({ gitlab: { pageSize: 2 } })
  for (let i = 0; i < 5; i++) fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })

  const { host, worker } = await startWorker(fakes)
  assert.equal(lastStatusBar(host)?.text, '5')
  assert.equal(reviewRequestPolls(fakes), 3)
  await worker.deactivate()
})

/**
 * Mounts the worker so a test can change a setting as the person would in Orca's Settings. The
 * test kit never tells the worker's settings.onDidChange listeners (real Orca does), so this
 * stands in for that one event and awaits the listeners.
 */
async function startWorkerWithSettings(fakes: Fakes, settings: Record<string, string | number>) {
  const module = createWorker(fakes.deps)
  const listeners: ((change: { key: string }) => unknown)[] = []
  let orca: OrcaWorkerApi | undefined
  const host = mockHost({ settings })
  const worker = await mountWorker(
    {
      default: (api: OrcaWorkerApi) => {
        orca = api
        // The kit's api objects are frozen, so wrap with copies rather than patching them.
        const settingsApi = {
          ...api.settings,
          onDidChange(listener: (change: { key: string }) => void) {
            listeners.push(listener)
            return { dispose: () => void listeners.splice(listeners.indexOf(listener), 1) }
          }
        } as OrcaWorkerApi['settings']
        return module.default({ ...api, settings: settingsApi })
      },
      deactivate: module.deactivate
    },
    { host }
  )
  await fakes.clock.advance(0)
  const changeSetting = async (key: string, value: string | number) => {
    await orca!.settings.set(key, value)
    for (const listener of [...listeners]) await listener({ key })
    await fakes.clock.advance(0)
  }
  return { host, worker, changeSetting }
}

test('starts polling as soon as the instance URL is set', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  const { host, worker, changeSetting } = await startWorkerWithSettings(fakes, {})
  assert.equal(fakes.clock.pending, 0)

  await changeSetting('instanceUrl', 'https://gitlab.example.com')
  assert.equal(reviewRequestPolls(fakes), 1)
  assert.equal(lastStatusBar(host)?.text, '1')
  await worker.deactivate()
})

test('a new interval applies from the last poll', async () => {
  const fakes = fakeDeps()
  const { worker, changeSetting } = await startWorkerWithSettings(fakes, CONFIGURED)

  await fakes.clock.advance(2 * MINUTE)
  await changeSetting('pollMinutes', 3)
  await fakes.clock.advance(1 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 2)
  await worker.deactivate()
})

test('a new instance URL is polled at once', async () => {
  const fakes = fakeDeps()
  const { worker, changeSetting } = await startWorkerWithSettings(fakes, CONFIGURED)

  await changeSetting('instanceUrl', 'https://gitlab.acme.dev')
  assert.deepEqual(
    fakes.connections.map((c) => c.host),
    ['gitlab.example.com', 'gitlab.acme.dev']
  )
  assert.equal(reviewRequestPolls(fakes), 2)
  await worker.deactivate()
})

test('stops its timers when deactivated', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)

  await worker.deactivate()
  assert.equal(fakes.clock.pending, 0)
})
