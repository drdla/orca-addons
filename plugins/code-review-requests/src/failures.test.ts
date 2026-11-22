// Failure states and recovery (#15, #24), through the worker's public surface: a configured
// worker over the fake GitLab and clock, observed through polls, the status bar, notifications,
// its commands and rr.snapshot.
import { assert, test } from 'orca/testing'
import { fakeDeps } from './fakes'
import { GitLabError } from './seams/gitlab'
import { CONFIGURED, lastStatusBar, MINUTE, reviewRequestPolls, startWorker } from './testing/worker-harness'

const down = () => new GitLabError('transient', 'gitlab.example.com: 503 Service Unavailable', { status: 503 })

test('a transient failure is retried after 1, 2 and 4 minutes, then at the poll interval', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes, { ...CONFIGURED, pollMinutes: 5 })
  fakes.gitlab.failNext(down(), down(), down(), down(), down())

  const pollsAt: number[] = []
  const started = fakes.clock.now()
  for (let minute = 1; minute <= 22; minute++) {
    const before = reviewRequestPolls(fakes)
    await fakes.clock.advance(MINUTE)
    if (reviewRequestPolls(fakes) > before) pollsAt.push((fakes.clock.now() - started) / MINUTE)
  }

  // 5: fails, 6: fails (+1), 8: fails (+2), 12: fails (+4), 17: fails (capped +5), 22: works.
  assert.deepEqual(pollsAt, [5, 6, 8, 12, 17, 22])
  await worker.deactivate()
})

test('while transient failures last, the status bar item keeps the count until the last good poll is older than 2× the interval', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  const { host, worker } = await startWorker(fakes)
  const lastGood = fakes.clock.now()
  const firstRunNotes = host.callsOf('notifications.show').length
  fakes.gitlab.failNext(...Array.from({ length: 6 }, down))

  // Polls fail at 5, 6, 8 and 12 minutes.
  await fakes.clock.advance(8 * MINUTE)
  assert.equal(lastStatusBar(host)?.text, '1')
  const snapshot = await worker.request('rr.snapshot')
  assert.deepEqual(snapshot.reviewRequests.length, 1)
  assert.deepEqual(snapshot.gitlab, {
    status: 'retrying',
    message: 'gitlab.example.com: 503 Service Unavailable',
    lastSuccessAt: lastGood,
    retryAt: lastGood + 12 * MINUTE,
    rateLimitedUntil: null,
    offline: false
  })

  await fakes.clock.advance(4 * MINUTE)
  assert.equal(lastStatusBar(host)?.text, 'GitLab: offline')
  assert.equal(lastStatusBar(host)?.icon, 'warning')
  assert.equal(lastStatusBar(host)?.visible, true)
  assert.equal((await worker.request('rr.snapshot')).gitlab?.status, 'retrying')
  assert.equal(host.callsOf('notifications.show').length, firstRunNotes)

  // 17 and 22 fail too; 27 works.
  await fakes.clock.advance(15 * MINUTE)
  assert.equal(lastStatusBar(host)?.text, '1')
  assert.equal((await worker.request('rr.snapshot')).gitlab, undefined)
  await worker.deactivate()
})

test('the last list survives an outage: a failed poll never drops Review Requests', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7 })
  const { worker } = await startWorker(fakes)
  fakes.gitlab.merge('acme/api', 7)
  fakes.gitlab.failNext(down(), down())

  await fakes.clock.advance(6 * MINUTE)
  assert.equal((await worker.request('rr.snapshot')).reviewRequests.length, 1)
  await fakes.clock.advance(2 * MINUTE)
  assert.equal((await worker.request('rr.snapshot')).reviewRequests.length, 0)
  await worker.deactivate()
})

const fieldMissing = () =>
  new GitLabError('rejected', "Field 'reviewRequestedMergeRequests' doesn't exist on type 'CurrentUser'", {
    status: 200
  })

test('a GitLab older than 17.4 is Needs you, with the version it runs', async () => {
  const fakes = fakeDeps({ gitlab: { version: '17.2.1-ee' } })
  const { host, worker } = await startWorker(fakes)
  fakes.gitlab.failNext(fieldMissing())
  await worker.command('code-review-requests.refresh')

  assert.ok(fakes.gitlab.requests.some((r) => r.operation === 'GET /version'))
  assert.equal(lastStatusBar(host)?.text, 'GitLab: set up')
  const { gitlab } = await worker.request('rr.snapshot')
  assert.equal(gitlab?.status, 'needs-you')
  assert.equal(gitlab?.status === 'needs-you' && gitlab.reason, 'gitlab-too-old')
  assert.equal(gitlab?.status === 'needs-you' && gitlab.version, '17.2.1-ee')
  assert.match(lastStatusBar(host)?.tooltip ?? '', /runs GitLab 17\.2\.1-ee/)
  await worker.deactivate()
})

test('a refused query on a recent GitLab is retried like a transient failure', async () => {
  const fakes = fakeDeps({ gitlab: { version: '18.0.0' } })
  const { host, worker } = await startWorker(fakes)
  fakes.gitlab.failNext(fieldMissing())
  await worker.command('code-review-requests.refresh')

  assert.equal(lastStatusBar(host)?.text, '0')
  assert.equal((await worker.request('rr.snapshot')).gitlab?.status, 'retrying')
  await fakes.clock.advance(1 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 3)
  await worker.deactivate()
})

const rateLimited = (retryAfterMs?: number) =>
  new GitLabError('transient', 'gitlab.example.com: Retry later', {
    status: 429,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs })
  })

test('a 429 waits for Retry-After, and Refresh says so instead of polling until then', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)
  fakes.gitlab.failNext(rateLimited(10 * MINUTE))
  await worker.command('code-review-requests.refresh')

  assert.match(String(await worker.command('code-review-requests.refresh')), /^Rate-limited until \d\d:\d\d\.$/)
  assert.equal(reviewRequestPolls(fakes), 2)

  await fakes.clock.advance(9 * MINUTE + 30_000)
  assert.equal(reviewRequestPolls(fakes), 2)
  await fakes.clock.advance(30_000)
  assert.equal(reviewRequestPolls(fakes), 3)
  assert.equal(await worker.command('code-review-requests.refresh'), '0 Review Requests.')
  await worker.deactivate()
})

const loggedOut = () =>
  new GitLabError('needs-you', 'gitlab.example.com: 401 Unauthorized', { status: 401, reason: 'logged-out' })

test('Needs you stops polling and shows "GitLab: set up" in place of the status bar item', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  fakes.gitlab.failNext(loggedOut())
  const { host, worker } = await startWorker(fakes)

  await fakes.clock.advance(60 * MINUTE)
  assert.equal(fakes.gitlab.requests.length, 1)
  assert.equal(fakes.clock.pending, 0)
  assert.deepEqual(lastStatusBar(host), {
    id: 'review-requests',
    text: 'GitLab: set up',
    icon: 'plug',
    tone: 'warning',
    tooltip: 'GitLab needs setting up: glab is not logged in to gitlab.example.com. Click to open.',
    visible: true
  })
  await worker.deactivate()
})

test('logged out of the configured host: the checklist offers the other hosts glab is logged in to', async () => {
  const fakes = fakeDeps()
  fakes.glab.loggedIn = ['gitlab.com', 'gitlab.example.com', 'gitlab.other.com']
  fakes.gitlab.failNext(loggedOut())
  const { worker } = await startWorker(fakes)

  const problem = (await worker.request('rr.snapshot')).gitlab
  assert.equal(problem?.status === 'needs-you' && problem.reason, 'logged-out')
  assert.deepEqual(problem?.status === 'needs-you' ? problem.glabHosts : null, ['gitlab.com', 'gitlab.other.com'])
  await worker.deactivate()
})

test('nothing asks glab which hosts it is logged in to until a poll finds it logged out', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)

  assert.equal(fakes.glab.statusChecks, 0)
  await worker.deactivate()
})

test('Use <host> points the instance URL at that host and polls it at once', async () => {
  const fakes = fakeDeps()
  fakes.glab.loggedIn = ['gitlab.other.com']
  fakes.gitlab.failNext(loggedOut())
  const { host, worker } = await startWorker(fakes)

  await worker.request('rr.useHost', { host: 'gitlab.other.com' })

  assert.equal(host.data().settings.instanceUrl, 'https://gitlab.other.com')
  assert.equal(fakes.connections.at(-1)?.host, 'gitlab.other.com')
  assert.equal((await worker.request('rr.snapshot')).gitlab, undefined)
  await worker.deactivate()
})

test('rr.copyText puts the text on the clipboard', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)

  await worker.request('rr.copyText', { text: 'glab auth login --hostname gitlab.example.com' })

  assert.deepEqual(fakes.desktop.clipboard, ['glab auth login --hostname gitlab.example.com'])
  await worker.deactivate()
})

test('the first run sends no notification for Needs you: the status bar covers it', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.failNext(loggedOut())
  const { host, worker } = await startWorker(fakes)

  assert.deepEqual(host.callsOf('notifications.show'), [])
  await worker.deactivate()
})

test('breaking after working sends exactly one notification, even across retries and restarts', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startWorker(fakes)
  fakes.gitlab.failNext(loggedOut(), loggedOut(), loggedOut())

  await worker.command('code-review-requests.refresh')
  await worker.command('code-review-requests.refresh')
  await worker.deactivate()
  const restarted = await startWorker(fakes, CONFIGURED, host)

  assert.deepEqual(host.callsOf('notifications.show'), [
    {
      title: "Can't check for Review Requests",
      body: 'glab is not logged in to gitlab.example.com. Click the status bar to fix it.'
    }
  ])
  await restarted.worker.deactivate()
})

test('Refresh retries a Needs you failure, and once it works polling resumes', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  fakes.gitlab.failNext(loggedOut())
  const { host, worker } = await startWorker(fakes)

  assert.equal(await worker.command('code-review-requests.refresh'), '1 Review Request.')
  assert.equal(lastStatusBar(host)?.text, '1')
  await fakes.clock.advance(5 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 2)
  await worker.deactivate()
})

test('the panel’s Retry (rr.refresh) polls at once and answers with the new snapshot, unless rate-limited', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  fakes.gitlab.failNext(loggedOut())
  const { worker } = await startWorker(fakes)

  const retried = await worker.request('rr.refresh')
  assert.equal(retried.gitlab, undefined)
  assert.equal(retried.reviewRequests.length, 1)

  fakes.gitlab.failNext(rateLimited(10 * MINUTE))
  await worker.command('code-review-requests.refresh')
  const limited = await worker.request('rr.refresh')
  assert.equal(reviewRequestPolls(fakes), 2)
  assert.match(limited.gitlab?.status === 'retrying' ? (limited.gitlab.rateLimitedUntil ?? '') : '', /^\d\d:\d\d$/)
  await worker.deactivate()
})

test('after Needs you, a new instance URL is tried at once, but another interval is not', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.failNext(loggedOut())
  const { worker, changeSetting } = await startWorker(fakes)

  await changeSetting('pollMinutes', 10)
  assert.equal(fakes.gitlab.requests.length, 1)
  await changeSetting('instanceUrl', 'https://gitlab.acme.dev')
  assert.equal(reviewRequestPolls(fakes), 1)
  await worker.deactivate()
})

test('a broken instance URL is Needs you', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startWorker(fakes, { ...CONFIGURED, instanceUrl: 'https://exa mple' })

  assert.equal(lastStatusBar(host)?.text, 'GitLab: set up')
  assert.equal(fakes.clock.pending, 0)
  const snapshot = await worker.request('rr.snapshot')
  assert.equal(snapshot.gitlab?.status, 'needs-you')
  assert.equal(snapshot.gitlab?.status === 'needs-you' && snapshot.gitlab.reason, 'bad-url')
  await worker.deactivate()
})

test('a 429 without Retry-After backs off like any transient failure', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)
  fakes.gitlab.failNext(rateLimited())
  await worker.command('code-review-requests.refresh')

  await fakes.clock.advance(1 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 3)
  await worker.deactivate()
})
