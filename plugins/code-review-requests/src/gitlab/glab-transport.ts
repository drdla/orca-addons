// The glab GitLabTransport (#8, #20): every call is one `glab api --hostname <host> --include`
// run, spawned by absolute path. `--include` puts the HTTP status line and headers before the
// body on stdout, which is how failures are told apart (glab itself only exits 1).
import { GitLabError, type GitLabTransport, type HttpMethod, type Json } from '../seams/gitlab'

/** One finished glab run. Rejects only when glab could not be started (errno error). */
export type GlabRun = { exitCode: number; stdout: string; stderr: string }
export type RunGlab = (file: string, args: string[], stdin: string | undefined) => Promise<GlabRun>

export type GlabTransportOptions = {
  /** Host name only, as passed to `--hostname`. */
  host: string
  run: RunGlab
  /** The absolute path of glab, or null when it isn't installed. Called on first use. */
  locate: () => string | null
}

type Response = { status: number; body: unknown }

export function createGlabTransport(options: GlabTransportOptions): GitLabTransport {
  const { host, run, locate } = options

  async function call(endpoint: string, method: HttpMethod, body: Json | undefined): Promise<Response> {
    const args = ['api', '--hostname', host, '--include', '--method', method, endpoint]
    if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--input', '-')
    const stdin = body === undefined ? undefined : JSON.stringify(body)
    const glab = locate()
    if (!glab) throw glabNotFound()
    let result: GlabRun
    try {
      result = await run(glab, args, stdin)
    } catch (e) {
      if ((e as { code?: unknown }).code === 'ENOENT') throw glabNotFound()
      throw new GitLabError('needs-you', `glab could not run: ${(e as Error).message}`)
    }
    const response = splitIncluded(result.stdout)
    if (!response) throw new GitLabError('transient', `glab got no response from ${host}: ${oneLine(result.stderr)}`)
    const parsed = parseBody(response.body)
    const { status } = response
    if (status >= 200 && status < 300) return { status, body: parsed }

    const message = `${host}: ${messageOf(parsed) ?? oneLine(result.stderr)}`
    if (status === 401) {
      throw new GitLabError('needs-you', `${message}. Run \`glab auth login --hostname ${host}\`.`, {
        status,
        reason: 'logged-out'
      })
    }
    if (status === 429 || status >= 500) {
      const retryAfterMs = retryAfter(response.headers)
      throw new GitLabError('transient', message, { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) })
    }
    throw new GitLabError('rejected', message, { status })
  }

  return {
    async graphql<T>(query: string, variables: Record<string, Json> = {}): Promise<T> {
      const { status, body } = await call('graphql', 'POST', { query, variables })
      const { data, errors } = (body ?? {}) as { data?: T; errors?: { message: string }[] }
      if (errors?.length) {
        throw new GitLabError('rejected', errors.map((e) => e.message).join('; '), { status })
      }
      return data as T
    },
    async rest<T>(method: HttpMethod, path: string, body?: Json): Promise<T> {
      return (await call(path, method, body)).body as T
    }
  }
}

/**
 * Finds glab by absolute path. A worker forked early after a Dock launch has only Orca's seeded
 * PATH, without the user's shell additions (research #2), so the usual install folders are
 * tried after PATH. Relative PATH entries are skipped.
 */
export function locateGlab(
  env: { PATH?: string; HOME?: string },
  isExecutable: (path: string) => boolean
): string | null {
  const dirs = [
    ...(env.PATH ?? '').split(':'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(env.HOME ? [`${env.HOME}/.local/bin`] : [])
  ]
  for (const dir of dirs) {
    if (!dir.startsWith('/')) continue
    const candidate = `${dir.replace(/\/+$/, '')}/glab`
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function glabNotFound(): GitLabError {
  return new GitLabError('needs-you', 'glab not found. Install it (brew install glab) and run `glab auth login`.', {
    reason: 'glab-missing'
  })
}

type Included ={ status: number; headers: Map<string, string>; body: string }

/** Reads `--include` output: `HTTP/2.0 200 OK\n`, `Name: value\r\n` lines, `\r\n`, body. */
function splitIncluded(stdout: string): Included | null {
  const statusLine = /^HTTP\/[\d.]+ (\d{3})/.exec(stdout)
  if (!statusLine) return null
  const separator = /\r?\n\r?\n/.exec(stdout)
  const head = separator ? stdout.slice(0, separator.index) : stdout
  const headers = new Map<string, string>()
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return {
    status: Number(statusLine[1]),
    headers,
    body: separator ? stdout.slice(separator.index + separator[0].length) : ''
  }
}

/** JSON when it parses, the raw text otherwise (an HTML error page), null when empty. */
function parseBody(body: string): unknown {
  if (body.trim() === '') return null
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/** GitLab's error text: `{"message": …}` (a string or a field → errors object) or `{"error": …}`. */
function messageOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const { message, error } = body as { message?: unknown; error?: unknown }
  const value = message ?? error
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * `Retry-After` in seconds, or as an HTTP date measured against the response's `Date`. Without it,
 * GitLab's `RateLimit-Reset` (Unix seconds), also measured against `Date`.
 */
function retryAfter(headers: Map<string, string>): number | undefined {
  const now = Date.parse(headers.get('date') ?? '')
  const value = headers.get('retry-after')
  if (value) {
    if (/^\d+$/.test(value)) return Number(value) * 1000
    const at = Date.parse(value)
    return Number.isNaN(at) || Number.isNaN(now) ? undefined : Math.max(0, at - now)
  }
  const reset = headers.get('ratelimit-reset')
  if (!reset || !/^\d+$/.test(reset) || Number.isNaN(now)) return undefined
  return Math.max(0, Number(reset) * 1000 - now)
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim() || 'glab failed without output'
}
