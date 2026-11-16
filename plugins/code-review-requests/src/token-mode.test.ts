// Token mode and the Connection section, worker side (#8, #25): a token stored in secrets for the
// configured host means token mode, otherwise glab, never a silent fallback. Tokens are validated
// on save, scopes gate posting, and no token ever reaches a message, a log or the panel.
// The tokens here are made-up strings that only the fake GitLab accepts.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps } from './fakes'
import { GitLabError } from './seams/gitlab'
import { CONFIGURED, lastStatusBar, MINUTE, reviewRequestPolls, startWorker } from './testing/worker-harness'

const TOKEN = 'glpat-FAKE-token-for-tests-only'
const KEY = 'token:gitlab.example.com'

function hostWith(secrets: Record<string, string> = {}, settings: Record<string, string | number> = CONFIGURED) {
  return mockHost({ settings, secrets })
}

test('a token stored for the configured host means token mode', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  const { host, worker } = await startWorker(fakes, CONFIGURED, hostWith({ [KEY]: TOKEN }))

  assert.deepEqual(fakes.connections.at(-1), { host: 'gitlab.example.com', token: TOKEN, glabPath: null })
  assert.equal(lastStatusBar(host)?.text, '1')
  await worker.deactivate()
})

test('without a token for this host, glab is used: a token stored for another host is never sent', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes, CONFIGURED, hostWith({ 'token:gitlab.com': TOKEN }))

  assert.deepEqual(
    fakes.connections.map((c) => c.token),
    fakes.connections.map(() => null)
  )
  assert.ok(fakes.connections.length > 0)
  await worker.deactivate()
})

test('a rejected token is Needs you ("token rejected"), with no fallback to glab', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN)
  const { host, worker } = await startWorker(fakes, CONFIGURED, hostWith({ [KEY]: TOKEN }))
  fakes.gitlab.revokeToken(TOKEN)

  await worker.command('code-review-requests.refresh')
  await fakes.clock.advance(60 * MINUTE)

  const snapshot = await worker.request('rr.snapshot')
  assert.equal(snapshot.gitlab?.status === 'needs-you' && snapshot.gitlab.reason, 'token-rejected')
  assert.equal(lastStatusBar(host)?.text, 'GitLab: set up')
  assert.ok(fakes.connections.every((c) => c.token === TOKEN))
  await worker.deactivate()
})

test('the Connection section shows the source, the signed-in user and what the scopes allow', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN, ['read_api'])
  const { worker } = await startWorker(fakes, CONFIGURED, hostWith({ [KEY]: TOKEN }))

  const connection = await worker.request('rr.connection', { test: false })

  assert.deepEqual(connection, {
    configured: true,
    host: 'gitlab.example.com',
    source: 'token',
    user: 'me',
    scopes: ['read_api'],
    canList: true,
    canPost: false,
    tokenStorage: 'os-keyring',
    problem: null
  })
  assert.ok(!JSON.stringify(connection).includes(TOKEN))
  await worker.deactivate()
})

test('in glab mode the scopes come from glab’s token when GitLab says, and are unknown otherwise', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes)

  const unknown = await worker.request('rr.connection', { test: false })
  fakes.gitlab.glabScopes = ['api']
  const known = await worker.request('rr.connection', { test: true })

  assert.deepEqual(
    [unknown.source, unknown.user, unknown.scopes, unknown.canList, unknown.canPost],
    ['glab', 'me', null, true, null]
  )
  assert.deepEqual([known.scopes, known.canPost], [['api'], true])
  await worker.deactivate()
})

test('a valid token is stored per host on save, and polling switches to it at once', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN)
  const { host, worker } = await startWorker(fakes)
  const pollsBefore = reviewRequestPolls(fakes)

  const saved = await worker.request('rr.saveToken', { token: `  ${TOKEN}\n` })

  assert.equal(saved.error, null)
  assert.equal(saved.connection.source, 'token')
  assert.equal(saved.connection.canPost, true)
  assert.equal(host.data().secrets[KEY], TOKEN)
  assert.deepEqual(Object.keys(host.data().storage).filter((k) => JSON.stringify(host.data().storage[k]).includes(TOKEN)), [])
  assert.deepEqual(Object.values(host.data().settings).filter((v) => String(v).includes(TOKEN)), [])
  assert.equal(reviewRequestPolls(fakes), pollsBefore + 1)
  assert.deepEqual(fakes.connections.at(-1), { host: 'gitlab.example.com', token: TOKEN, glabPath: null })
  await worker.deactivate()
})

test('a token GitLab rejects is not stored, and the answer says why without echoing it', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startWorker(fakes)

  const saved = await worker.request('rr.saveToken', { token: TOKEN })

  assert.match(saved.error ?? '', /rejected/)
  assert.ok(!(saved.error ?? '').includes(TOKEN))
  assert.equal(host.data().secrets[KEY], undefined)
  assert.equal(saved.connection.source, 'glab')
  await worker.deactivate()
})

test('a token without read_api is not stored: it could not list Review Requests', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN, ['read_user'])
  const { host, worker } = await startWorker(fakes)

  const saved = await worker.request('rr.saveToken', { token: TOKEN })

  assert.match(saved.error ?? '', /read_api/)
  assert.equal(host.data().secrets[KEY], undefined)
  await worker.deactivate()
})

test('a token with only read_api is stored: it lists, and only posting is disabled', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN, ['read_api'])
  const { host, worker } = await startWorker(fakes)

  const saved = await worker.request('rr.saveToken', { token: TOKEN })

  assert.equal(saved.error, null)
  assert.equal(host.data().secrets[KEY], TOKEN)
  assert.deepEqual([saved.connection.canList, saved.connection.canPost], [true, false])
  await worker.deactivate()
})

test('saving a token while glab needs setting up resumes polling at once', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  fakes.gitlab.failNext(new GitLabError('needs-you', 'glab not found', { reason: 'glab-missing' }))
  const { host, worker } = await startWorker(fakes)
  assert.equal(lastStatusBar(host)?.text, 'GitLab: set up')

  await worker.request('rr.saveToken', { token: TOKEN })

  assert.equal(lastStatusBar(host)?.text, '1')
  assert.equal((await worker.request('rr.snapshot')).gitlab, undefined)
  await fakes.clock.advance(5 * MINUTE)
  assert.equal(reviewRequestPolls(fakes), 2)
  await worker.deactivate()
})

test('removing a rejected token goes back to glab and polls again at once', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  const { host, worker } = await startWorker(fakes, CONFIGURED, hostWith({ [KEY]: TOKEN }))
  assert.equal(lastStatusBar(host)?.text, 'GitLab: set up')

  const connection = await worker.request('rr.removeToken')

  assert.equal(connection.source, 'glab')
  assert.equal(host.data().secrets[KEY], undefined)
  assert.equal(lastStatusBar(host)?.text, '1')
  assert.equal(fakes.connections.at(-1)?.token, null)
  await worker.deactivate()
})

test('without OS secret protection, tokens cannot be saved and only glab works', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN)
  const host = mockHost({ settings: CONFIGURED, results: { 'secrets.protection': { status: 'unavailable' } } })
  const { worker } = await startWorker(fakes, CONFIGURED, host)

  const saved = await worker.request('rr.saveToken', { token: TOKEN })

  assert.equal(saved.connection.tokenStorage, 'unavailable')
  assert.match(saved.error ?? '', /only glab/i)
  assert.equal(fakes.connections.every((c) => c.token === null), true)
  await worker.deactivate()
})

test('before GitLab is configured, the Connection section calls out to nothing', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes, {}, mockHost({}))

  const connection = await worker.request('rr.connection', { test: true })

  assert.equal(connection.configured, false)
  assert.deepEqual(fakes.gitlab.requests, [])
  await worker.deactivate()
})

test('a token GitLab echoes in an error never reaches the snapshot, the logs or the status bar', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.issueToken(TOKEN)
  const { host, worker } = await startWorker(fakes, CONFIGURED, hostWith({ [KEY]: TOKEN }))
  fakes.gitlab.failNext(new GitLabError('transient', `proxy refused PRIVATE-TOKEN ${TOKEN}`, { status: 502 }))

  const refreshed = await worker.command('code-review-requests.refresh')
  const snapshot = await worker.request('rr.snapshot')

  const seen = JSON.stringify([refreshed, snapshot, worker.logs, host.callsOf('statusBar.update'), worker.posts])
  assert.ok(!seen.includes(TOKEN))
  assert.match(seen, /\[token\]/)
  await worker.deactivate()
})
