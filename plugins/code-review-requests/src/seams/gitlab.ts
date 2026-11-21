// The GitLabTransport seam: everything that talks to the Forge goes through it. Two real
// transports implement it (glab, #20; token, #25); tests use the stateful fake in
// src/fakes/fake-gitlab.ts.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface GitLabTransport {
  /**
   * Runs a GraphQL query and resolves with its `data`. A response with `errors` rejects with a
   * GitLabError.
   */
  graphql<T>(query: string, variables?: Record<string, Json>): Promise<T>
  /**
   * Calls the REST API. `path` is relative to `/api/v4` and starts with `/`, with project paths
   * URL-encoded (`/projects/acme%2Fapi/merge_requests/7`). Resolves with the parsed JSON body
   * (`null` for an empty body).
   */
  rest<T>(method: HttpMethod, path: string, body?: Json): Promise<T>
}

/**
 * The transport for the configured connection, with its token (to redact from errors), or null
 * for glab. What posting a review (#30) and building a Review Cover Page (#55) reach GitLab with.
 */
export type GitLabAccess = { transport: GitLabTransport; token: string | null }

/** Which GitLab instance to reach, and with what. A stored token means token mode (#8). */
export type GitLabConnection = {
  /** Host name only, for example `gitlab.com`; the value passed to `glab --hostname`. */
  host: string
  /** The personal access token for `host`, or null to use glab. */
  token: string | null
  /** The "glab path" setting, or null to probe PATH and the usual install folders. */
  glabPath: string | null
}

/**
 * How a failure should be handled (#15):
 * - `needs-you`: glab missing or logged out, token rejected (401), GitLab too old. Stop polling.
 * - `transient`: network, 5xx, 429. Retry with backoff, honouring `retryAfterMs`.
 * - `rejected`: the request itself was refused (400, 403, 404, 409, 422). Report it inline.
 */
export type GitLabFailure = 'needs-you' | 'transient' | 'rejected'

/**
 * Which setup step a `needs-you` failure points at, so the panel can show the right fix (#24):
 * glab isn't installed, glab (or the token, #25) isn't accepted by the host, the instance runs a
 * GitLab older than 17.4, or the instance URL isn't a URL.
 */
export type NeedsYouReason = 'glab-missing' | 'logged-out' | 'token-rejected' | 'gitlab-too-old' | 'bad-url'

export class GitLabError extends Error {
  readonly kind: GitLabFailure
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined
  readonly reason: NeedsYouReason | undefined

  constructor(
    kind: GitLabFailure,
    message: string,
    details: { status?: number; retryAfterMs?: number; reason?: NeedsYouReason } = {}
  ) {
    super(message)
    this.name = 'GitLabError'
    this.kind = kind
    this.status = details.status
    this.retryAfterMs = details.retryAfterMs
    this.reason = details.reason
  }
}
