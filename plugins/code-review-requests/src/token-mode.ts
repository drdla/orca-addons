// Token mode and the Connection section, worker side (#8, #25). A personal access token is stored
// in secrets under `token:<host>` only after it worked when saved: `GET /user`, plus its scopes
// from `GET /personal_access_tokens/self`. At least `read_api` is needed to list; a missing `api`
// only disables posting. Saving or removing a token changes the connection, so the worker polls
// with the new one at once (also out of Needs you).
//
// No token ever leaves this module in a message: every error text goes through redact().
import { connectionFor, hostOf, tokenKey } from './connection'
import type { Deps } from './deps'
import { redact } from './gitlab/http-response'
import type { ConnectionView } from './protocol'
import { GitLabError, type GitLabConnection, type GitLabTransport } from './seams/gitlab'
import type { Settings } from './settings'

export type TokenModeOptions = {
  deps: Pick<Deps, 'gitLab'>
  secrets: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
  /** `secrets.protection` from the host. */
  protection: () => Promise<'os-keyring' | 'unavailable'>
  settings: () => Promise<Settings>
  isConfigured: () => Promise<boolean>
  /** The token for the configured host changed: re-read the connection and poll at once. */
  onTokenChanged: () => Promise<void>
}

type Checked = { user: string; scopes: string[] | null }

/** Lists Review Requests: `read_api` or `api`. Unknown scopes (null) are given the benefit of the doubt. */
export function canList(scopes: string[] | null): boolean {
  return scopes === null || scopes.includes('api') || scopes.includes('read_api')
}

/** Posts reviews: `api`. Null when GitLab didn't say; a post then reports a 403 itself (#8). */
export function canPost(scopes: string[] | null): boolean | null {
  return scopes === null ? null : scopes.includes('api')
}

/** Who the transport signs in as, and its token's scopes if GitLab tells. */
export async function checkConnection(transport: GitLabTransport): Promise<Checked> {
  const { username } = await transport.rest<{ username: string }>('GET', '/user')
  let scopes: string[] | null = null
  try {
    scopes = (await transport.rest<{ scopes?: string[] }>('GET', '/personal_access_tokens/self')).scopes ?? null
  } catch (error) {
    // An OAuth login (glab) has no personal access token behind it: scopes stay unknown.
    if (!(error instanceof GitLabError && error.kind === 'rejected')) throw error
  }
  return { user: username, scopes }
}

export function createTokenMode(options: TokenModeOptions) {
  const checked = new Map<string, Checked>()

  function view(over: Partial<ConnectionView>, tokenStorage: ConnectionView['tokenStorage']): ConnectionView {
    return {
      configured: true,
      host: null,
      source: 'glab',
      user: null,
      scopes: null,
      canList: null,
      canPost: null,
      tokenStorage,
      problem: null,
      ...over
    }
  }

  function fromCheck(connection: GitLabConnection, result: Checked, tokenStorage: ConnectionView['tokenStorage']) {
    return view(
      {
        host: connection.host,
        source: connection.token === null ? 'glab' : 'token',
        user: result.user,
        scopes: result.scopes,
        canList: canList(result.scopes),
        canPost: canPost(result.scopes)
      },
      tokenStorage
    )
  }

  async function current(test: boolean): Promise<ConnectionView> {
    const tokenStorage = await options.protection()
    if (!(await options.isConfigured())) return view({ configured: false }, tokenStorage)
    let connection: GitLabConnection
    try {
      connection = await connectionFor(await options.settings(), options.secrets)
    } catch (error) {
      return view({ problem: messageOf(error) }, tokenStorage)
    }
    const key = keyOf(connection)
    let result = test ? undefined : checked.get(key)
    if (result === undefined) {
      try {
        result = await checkConnection(options.deps.gitLab(connection))
        checked.set(key, result)
      } catch (error) {
        const rejected = error instanceof GitLabError && error.kind === 'needs-you'
        return view(
          {
            host: connection.host,
            source: connection.token === null ? 'glab' : 'token',
            canList: rejected ? false : null,
            problem: redact(messageOf(error), connection.token)
          },
          tokenStorage
        )
      }
    }
    return fromCheck(connection, result, tokenStorage)
  }

  /** Why the token can't be saved, or null once it is stored. */
  async function store(raw: string): Promise<string | null> {
    const token = raw.trim()
    if (token === '') return 'Paste a token first.'
    if ((await options.protection()) === 'unavailable') {
      return 'This system has no secure key store, so a token cannot be saved. Only glab works here.'
    }
    if (!(await options.isConfigured())) return 'Set the GitLab instance URL in Settings first.'
    let host: string
    try {
      host = hostOf((await options.settings()).instanceUrl)
    } catch (error) {
      return messageOf(error)
    }
    const connection = { host, token }
    let result: Checked
    try {
      result = await checkConnection(options.deps.gitLab(connection))
    } catch (error) {
      if (error instanceof GitLabError && error.kind === 'needs-you') {
        return `${host} rejected the token (expired, revoked or mistyped). Nothing was saved.`
      }
      return redact(`Couldn't check the token, so nothing was saved: ${messageOf(error)}`, token)
    }
    if (!canList(result.scopes)) {
      return 'The token needs the read_api scope (or api, to post reviews too). Nothing was saved.'
    }
    await options.secrets.set(tokenKey(host), token)
    checked.set(keyOf(connection), result)
    await options.onTokenChanged()
    return null
  }

  return {
    /** The Connection section's view; `test` re-checks instead of answering from the last check. */
    view: (test: boolean) => current(test),

    async save(raw: string): Promise<{ connection: ConnectionView; error: string | null }> {
      let error: string | null
      try {
        error = await store(raw)
      } catch (e) {
        error = redact(`Couldn't save the token: ${messageOf(e)}`, raw.trim())
      }
      return { connection: await current(false), error }
    },

    async remove(): Promise<ConnectionView> {
      if (await options.isConfigured()) {
        let host: string | null = null
        try {
          host = hostOf((await options.settings()).instanceUrl)
        } catch {
          // No host, so no token to remove; the view says what's wrong with the URL.
        }
        if (host !== null) {
          await options.secrets.delete(tokenKey(host))
          await options.onTokenChanged()
        }
      }
      return current(false)
    }
  }
}

/** Identifies a connection; the same key the worker caches its transport under. */
export function keyOf(connection: GitLabConnection | null): string {
  return connection === null ? '' : `${connection.host}\n${connection.token ?? ''}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
