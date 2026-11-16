// The token GitLabTransport (#8, #25): HTTPS straight from the worker with a personal access token
// in the PRIVATE-TOKEN header. A stored token for the configured host means this transport is
// used; a 401 is "token rejected" (Needs you) and never falls back to glab.
//
// The token must never reach a message, a log or the panel: every error text passes redact().
import { GitLabError, type GitLabTransport, type HttpMethod, type Json } from '../seams/gitlab'
import { errorTextOf, parseBody, redact, retryAfter } from './http-response'

export type FetchInit = { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
export type FetchResponse = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
/** The slice of `fetch` the transport uses; the real global fetch fits it. */
export type HttpFetch = (url: string, init: FetchInit) => Promise<FetchResponse>

export type TokenTransportOptions = {
  /** Host name only, as in GitLabConnection. */
  host: string
  token: string
  fetch: HttpFetch
  /** Per-request timeout; default 45 s, like a glab run. */
  timeoutMs?: number
}

export function createTokenTransport(options: TokenTransportOptions): GitLabTransport {
  const { host, token, fetch } = options
  const timeoutMs = options.timeoutMs ?? 45_000
  const fail = (kind: GitLabError['kind'], message: string, details: ConstructorParameters<typeof GitLabError>[2] = {}) =>
    new GitLabError(kind, redact(message, token), details)

  async function call(url: string, method: HttpMethod, body: Json | undefined): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { 'PRIVATE-TOKEN': token, Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let response: FetchResponse
    let text: string
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      text = await response.text()
    } catch (e) {
      throw fail('transient', `No response from ${host}: ${describe(e)}`)
    }
    const parsed = parseBody(text)
    const { status } = response
    if (status >= 200 && status < 300) return { status, body: parsed }

    const message = `${host}: ${errorTextOf(parsed) ?? `HTTP ${status}`}`
    if (status === 401) {
      throw fail('needs-you', `${message}. The token was rejected (expired or revoked).`, { status, reason: 'token-rejected' })
    }
    if (status === 429 || status >= 500) {
      const retryAfterMs = retryAfter((name) => response.headers.get(name) ?? undefined)
      throw fail('transient', message, { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) })
    }
    throw fail('rejected', message, { status })
  }

  return {
    async graphql<T>(query: string, variables: Record<string, Json> = {}): Promise<T> {
      const { status, body } = await call(`https://${host}/api/graphql`, 'POST', { query, variables })
      const { data, errors } = (body ?? {}) as { data?: T; errors?: { message: string }[] }
      if (errors?.length) throw fail('rejected', errors.map((e) => e.message).join('; '), { status })
      return data as T
    },
    async rest<T>(method: HttpMethod, path: string, body?: Json): Promise<T> {
      return (await call(`https://${host}/api/v4${path}`, method, body)).body as T
    }
  }
}

/** A fetch failure's message plus its cause (Node's fetch hides ENOTFOUND etc. in `cause`). */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as { cause?: unknown }).cause
  const causeText = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause)
  return causeText && !error.message.includes(causeText) ? `${error.message} (${causeText})` : error.message
}
