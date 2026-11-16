// Contract tests for the glab transport (#16): with spawning stubbed, they check only the glab
// command line it builds and how it reads glab's output and maps failures.
import { assert, test } from 'orca/testing'
import { glabGraphqlErrorOutput, glabNotFoundOutput, mergeRequestBody, reviewRequestsBody } from '../fixtures/gitlab-captures'
import { GitLabError } from '../seams/gitlab'
import { createGlabTransport, locateGlab, type GlabRun, type RunGlab } from './glab-transport'

const GLAB = '/opt/homebrew/bin/glab'

type Call = { file: string; args: string[]; stdin: string | undefined }

/** A stubbed spawn that records each call and answers with the given results in turn. */
function stubGlab(...results: (Partial<GlabRun> | Error)[]): { run: RunGlab; calls: Call[] } {
  const calls: Call[] = []
  const run: RunGlab = async (file, args, stdin) => {
    calls.push({ file, args, stdin })
    const next = results.shift() ?? {}
    if (next instanceof Error) throw next
    return { exitCode: 0, stdout: '', stderr: '', ...next }
  }
  return { run, calls }
}

/** What `glab api --include` prints: status line, headers, blank line, body. */
function included(status: string, body: string, headers: string[] = ['Content-Type: application/json']): string {
  return [`HTTP/2.0 ${status}`, ...headers.map((h) => `${h}\r`), '\r', body].join('\n')
}

function transport(run: RunGlab, host = 'gitlab.example.com') {
  return createGlabTransport({ host, run, locate: () => GLAB })
}

async function failure(promise: Promise<unknown>): Promise<GitLabError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof GitLabError) return e
    throw e
  }
  throw new Error('expected a GitLabError')
}

test('a REST GET runs glab api by absolute path against the configured host, and resolves with the body', async () => {
  const glab = stubGlab({ stdout: included('200 OK', JSON.stringify(mergeRequestBody)) })

  const mr = await transport(glab.run).rest('GET', '/projects/acme%2Fapi/merge_requests/101')

  assert.deepEqual(glab.calls, [
    {
      file: GLAB,
      args: ['api', '--hostname', 'gitlab.example.com', '--include', '--method', 'GET', '/projects/acme%2Fapi/merge_requests/101'],
      stdin: undefined
    }
  ])
  assert.deepEqual(mr, mergeRequestBody)
})

test('a REST call with a body sends it as JSON on stdin, and an empty 204 resolves with null', async () => {
  const glab = stubGlab({ stdout: included('204 No Content', '', []) })
  const body = { note: 'Summary', reviewer_state: 'reviewed' }
  const path = '/projects/acme%2Fapi/merge_requests/101/draft_notes/bulk_publish'

  const result = await transport(glab.run).rest('POST', path, body)

  assert.equal(result, null)
  assert.deepEqual(glab.calls[0]?.args, [
    'api', '--hostname', 'gitlab.example.com', '--include', '--method', 'POST', path,
    '-H', 'Content-Type: application/json', '--input', '-'
  ])
  assert.deepEqual(JSON.parse(glab.calls[0]?.stdin ?? ''), body)
})

test('a GraphQL query is POSTed to the graphql endpoint as JSON, and resolves with its data', async () => {
  const glab = stubGlab({ stdout: included('200 OK', JSON.stringify(reviewRequestsBody)) })
  const query = 'query ReviewRequests($me: String!) { currentUser { username } }'

  const data = await transport(glab.run).graphql(query, { me: 'me' })

  assert.deepEqual(data, reviewRequestsBody.data)
  assert.deepEqual(glab.calls[0]?.args, [
    'api', '--hostname', 'gitlab.example.com', '--include', '--method', 'POST', 'graphql',
    '-H', 'Content-Type: application/json', '--input', '-'
  ])
  assert.deepEqual(JSON.parse(glab.calls[0]?.stdin ?? ''), { query, variables: { me: 'me' } })
})

test('a GraphQL response with errors is rejected with their messages, though HTTP said 200', async () => {
  const glab = stubGlab({
    exitCode: 1,
    stdout: glabGraphqlErrorOutput,
    stderr: "glab: Field 'nope' doesn't exist on type 'CurrentUser'\n"
  })

  const error = await failure(transport(glab.run).graphql('query Q { currentUser { nope } }'))

  assert.equal(error.kind, 'rejected')
  assert.equal(error.status, 200)
  assert.match(error.message, /Field 'nope' doesn't exist on type 'CurrentUser'/)
})

test('a refused request (404) is rejected with GitLab’s message and status', async () => {
  const glab = stubGlab({ exitCode: 1, stdout: glabNotFoundOutput, stderr: 'glab: 404 Project Not Found (HTTP 404)\n' })

  const error = await failure(transport(glab.run).rest('GET', '/projects/0'))

  assert.equal(error.kind, 'rejected')
  assert.equal(error.status, 404)
  assert.match(error.message, /404 Project Not Found/)
})

test('a 401 means glab is logged out of this host: Needs you', async () => {
  const glab = stubGlab({
    exitCode: 1,
    stdout: included('401 Unauthorized', '{"message":"401 Unauthorized"}'),
    stderr: 'glab: 401 Unauthorized (HTTP 401)\n'
  })

  const error = await failure(transport(glab.run).rest('GET', '/user'))

  assert.equal(error.kind, 'needs-you')
  assert.equal(error.status, 401)
  assert.match(error.message, /glab auth login --hostname gitlab\.example\.com/)
})

test('rate limiting and server errors are Transient, honouring Retry-After', async () => {
  const glab = stubGlab(
    { exitCode: 1, stdout: included('429 Too Many Requests', '{"message":"Retry later"}', ['Retry-After: 30']) },
    { exitCode: 1, stdout: included('502 Bad Gateway', '<html>bad gateway</html>', ['Content-Type: text/html']) }
  )
  const gitlab = transport(glab.run)

  const limited = await failure(gitlab.rest('GET', '/version'))
  const down = await failure(gitlab.rest('GET', '/version'))

  assert.deepEqual([limited.kind, limited.status, limited.retryAfterMs], ['transient', 429, 30_000])
  assert.deepEqual([down.kind, down.status, down.retryAfterMs], ['transient', 502, undefined])
})

test('a 429 without Retry-After waits until RateLimit-Reset, measured against the response Date', async () => {
  const glab = stubGlab({
    exitCode: 1,
    stdout: included('429 Too Many Requests', '{"message":"Retry later"}', [
      'Date: Mon, 16 Nov 2026 09:00:00 GMT',
      `RateLimit-Reset: ${Date.UTC(2026, 10, 16, 9, 2, 0) / 1000}`
    ])
  })

  const limited = await failure(transport(glab.run).rest('GET', '/version'))

  assert.deepEqual([limited.kind, limited.retryAfterMs], ['transient', 120_000])
})

test('a 401 and a missing glab say which setup step is missing', async () => {
  const loggedOut = stubGlab({ exitCode: 1, stdout: included('401 Unauthorized', '{"message":"401 Unauthorized"}') })
  const missing = createGlabTransport({ host: 'gitlab.example.com', run: stubGlab().run, locate: () => null })

  const errors = [
    await failure(transport(loggedOut.run).rest('GET', '/user')),
    await failure(missing.rest('GET', '/user'))
  ]

  assert.deepEqual(errors.map((e) => e.reason), ['logged-out', 'glab-missing'])
})

test('a missing glab is Needs you, whether it was not found or vanished before spawning', async () => {
  const notFound = stubGlab()
  const missing = createGlabTransport({ host: 'gitlab.example.com', run: notFound.run, locate: () => null })
  const enoent = Object.assign(new Error('spawn /opt/homebrew/bin/glab ENOENT'), { code: 'ENOENT' })
  const vanished = transport(stubGlab(enoent).run)

  const errors = [await failure(missing.rest('GET', '/version')), await failure(vanished.rest('GET', '/version'))]

  assert.deepEqual(errors.map((e) => e.kind), ['needs-you', 'needs-you'])
  for (const e of errors) assert.match(e.message, /glab not found/)
  assert.deepEqual(notFound.calls, [])
})

test('glab is located by absolute path: on PATH first, then where installers put it', () => {
  const installed = (...paths: string[]) => (path: string) => paths.includes(path)
  const env = { PATH: '/usr/bin:relative/bin:/opt/tools/bin', HOME: '/Users/me' }

  assert.equal(locateGlab(env, installed('/opt/tools/bin/glab', '/opt/homebrew/bin/glab')), '/opt/tools/bin/glab')
  assert.equal(locateGlab({ ...env, PATH: '/usr/bin:/bin' }, installed('/opt/homebrew/bin/glab')), '/opt/homebrew/bin/glab')
  assert.equal(locateGlab({ HOME: '/Users/me' }, installed('/usr/local/bin/glab')), '/usr/local/bin/glab')
  assert.equal(locateGlab(env, installed('/Users/me/.local/bin/glab')), '/Users/me/.local/bin/glab')
  assert.equal(locateGlab(env, installed('relative/bin/glab')), null)
})

test('a "glab path" setting wins over probing; one that is not executable means glab is missing', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/me' }
  const installed = (...paths: string[]) => (path: string) => paths.includes(path)

  assert.equal(locateGlab(env, installed('/tools/glab', '/opt/homebrew/bin/glab'), '/tools/glab'), '/tools/glab')
  assert.equal(locateGlab(env, installed('/opt/homebrew/bin/glab'), '/tools/glab'), null)
  assert.equal(locateGlab(env, installed('/opt/homebrew/bin/glab'), null), '/opt/homebrew/bin/glab')
})

test('when glab gets no HTTP response at all (offline, DNS), the failure is Transient', async () => {
  const glab = stubGlab({
    exitCode: 1,
    stderr: '   ERROR  \n\n  Get "https://gitlab.example.com/api/v4/version": dial tcp: lookup gitlab.example.com: no such host.\n'
  })

  const error = await failure(transport(glab.run).rest('GET', '/version'))

  assert.equal(error.kind, 'transient')
  assert.equal(error.status, undefined)
  assert.match(error.message, /no such host/)
})
