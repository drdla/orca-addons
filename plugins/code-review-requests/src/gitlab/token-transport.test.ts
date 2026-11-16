// Contract tests for the token transport (#16, #25): with fetch stubbed, they check only the HTTP
// requests it builds and how it maps GitLab's answers to failures. The token is a made-up string;
// no real token is used or stored anywhere.
import { assert, test } from 'orca/testing'
import { mergeRequestBody, reviewRequestsBody } from '../fixtures/gitlab-captures'
import { GitLabError } from '../seams/gitlab'
import { createTokenTransport, type FetchInit, type HttpFetch } from './token-transport'

const TOKEN = 'glpat-FAKE-not-a-real-token-123'

type Call = { url: string; init: FetchInit }
type Answer = { status: number; body?: string; headers?: Record<string, string> } | Error

/** A stubbed fetch that records each call and answers with the given responses in turn. */
function stubFetch(...answers: Answer[]): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = []
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, init })
    const next = answers.shift() ?? { status: 200, body: 'null' }
    if (next instanceof Error) throw next
    const headers = new Map(Object.entries(next.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    return { status: next.status, headers: { get: (name) => headers.get(name.toLowerCase()) ?? null }, text: async () => next.body ?? '' }
  }
  return { fetch, calls }
}

function transport(fetch: HttpFetch) {
  return createTokenTransport({ host: 'gitlab.example.com', token: TOKEN, fetch })
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

test('a REST GET goes to the host’s /api/v4 with the token in a header, and resolves with the body', async () => {
  const http = stubFetch({ status: 200, body: JSON.stringify(mergeRequestBody) })

  const mr = await transport(http.fetch).rest('GET', '/projects/acme%2Fapi/merge_requests/101')

  assert.deepEqual(mr, mergeRequestBody)
  assert.equal(http.calls.length, 1)
  assert.equal(http.calls[0]!.url, 'https://gitlab.example.com/api/v4/projects/acme%2Fapi/merge_requests/101')
  assert.equal(http.calls[0]!.init.method, 'GET')
  assert.equal(http.calls[0]!.init.headers['PRIVATE-TOKEN'], TOKEN)
  assert.equal(http.calls[0]!.init.body, undefined)
})

test('a REST call with a body sends it as JSON, and an empty 204 resolves with null', async () => {
  const http = stubFetch({ status: 204 })
  const body = { note: 'Summary', reviewer_state: 'reviewed' }

  const result = await transport(http.fetch).rest('POST', '/projects/acme%2Fapi/merge_requests/101/draft_notes/bulk_publish', body)

  assert.equal(result, null)
  assert.equal(http.calls[0]!.init.method, 'POST')
  assert.equal(http.calls[0]!.init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(http.calls[0]!.init.body ?? ''), body)
})

test('a GraphQL query is POSTed to /api/graphql as JSON, and resolves with its data', async () => {
  const http = stubFetch({ status: 200, body: JSON.stringify(reviewRequestsBody) })
  const query = 'query ReviewRequests($me: String!) { currentUser { username } }'

  const data = await transport(http.fetch).graphql(query, { me: 'me' })

  assert.deepEqual(data, reviewRequestsBody.data)
  assert.equal(http.calls[0]!.url, 'https://gitlab.example.com/api/graphql')
  assert.equal(http.calls[0]!.init.method, 'POST')
  assert.equal(http.calls[0]!.init.headers['PRIVATE-TOKEN'], TOKEN)
  assert.deepEqual(JSON.parse(http.calls[0]!.init.body ?? ''), { query, variables: { me: 'me' } })
})

test('a GraphQL response with errors is rejected with their messages', async () => {
  const http = stubFetch({ status: 200, body: JSON.stringify({ errors: [{ message: "Field 'nope' doesn't exist" }] }) })

  const error = await failure(transport(http.fetch).graphql('query Q { nope }'))

  assert.equal(error.kind, 'rejected')
  assert.match(error.message, /Field 'nope' doesn't exist/)
})

test('a 401 means the token was rejected: Needs you, never a fallback to glab', async () => {
  const http = stubFetch({ status: 401, body: '{"message":"401 Unauthorized"}' })

  const error = await failure(transport(http.fetch).rest('GET', '/user'))

  assert.deepEqual([error.kind, error.status, error.reason], ['needs-you', 401, 'token-rejected'])
  assert.match(error.message, /gitlab\.example\.com: 401 Unauthorized/)
})

test('a refused request (404) is rejected with GitLab’s message and status', async () => {
  const http = stubFetch({ status: 404, body: '{"message":"404 Project Not Found"}' })

  const error = await failure(transport(http.fetch).rest('GET', '/projects/0'))

  assert.deepEqual([error.kind, error.status], ['rejected', 404])
  assert.match(error.message, /404 Project Not Found/)
})

test('rate limiting and server errors are Transient, honouring Retry-After and RateLimit-Reset', async () => {
  const http = stubFetch(
    { status: 429, body: '{"message":"Retry later"}', headers: { 'Retry-After': '30' } },
    { status: 502, body: '<html>bad gateway</html>' },
    {
      status: 429,
      headers: { Date: 'Mon, 16 Nov 2026 09:00:00 GMT', 'RateLimit-Reset': String(Date.UTC(2026, 10, 16, 9, 2, 0) / 1000) }
    }
  )
  const gitlab = transport(http.fetch)

  const limited = await failure(gitlab.rest('GET', '/version'))
  const down = await failure(gitlab.rest('GET', '/version'))
  const reset = await failure(gitlab.rest('GET', '/version'))

  assert.deepEqual([limited.kind, limited.status, limited.retryAfterMs], ['transient', 429, 30_000])
  assert.deepEqual([down.kind, down.status, down.retryAfterMs], ['transient', 502, undefined])
  assert.deepEqual([reset.kind, reset.retryAfterMs], ['transient', 120_000])
})

test('when no HTTP response comes back at all (offline, DNS, timeout), the failure is Transient', async () => {
  const http = stubFetch(new TypeError('fetch failed: getaddrinfo ENOTFOUND gitlab.example.com'))

  const error = await failure(transport(http.fetch).rest('GET', '/version'))

  assert.deepEqual([error.kind, error.status], ['transient', undefined])
  assert.match(error.message, /ENOTFOUND/)
})

test('the token never appears in an error message, whatever GitLab or the network echoes', async () => {
  const http = stubFetch(
    { status: 401, body: JSON.stringify({ message: `token ${TOKEN} is revoked` }) },
    { status: 400, body: JSON.stringify({ error: `bad header PRIVATE-TOKEN: ${TOKEN}` }) },
    new Error(`socket hang up while sending ${TOKEN}`)
  )
  const gitlab = transport(http.fetch)

  const errors = [
    await failure(gitlab.rest('GET', '/user')),
    await failure(gitlab.rest('GET', '/user')),
    await failure(gitlab.rest('GET', '/user'))
  ]

  for (const e of errors) {
    assert.ok(!e.message.includes(TOKEN), e.message)
    assert.ok(!(e.stack ?? '').includes(TOKEN))
    assert.match(e.message, /\[token\]/)
  }
})
