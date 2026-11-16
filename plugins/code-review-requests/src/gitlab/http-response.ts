// Reading GitLab's HTTP answers, shared by both transports (glab, token): the body, GitLab's error
// text, how long a rate limit asks us to wait, and keeping the token out of any text.
import { GitLabError } from '../seams/gitlab'

/** JSON when it parses, the raw text otherwise (an HTML error page), null when empty. */
export function parseBody(body: string): unknown {
  if (body.trim() === '') return null
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/** GitLab's error text: `{"message": …}` (a string or a field → errors object) or `{"error": …}`. */
export function errorTextOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const { message, error } = body as { message?: unknown; error?: unknown }
  const value = message ?? error
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * `Retry-After` in seconds, or as an HTTP date measured against the response's `Date`. Without it,
 * GitLab's `RateLimit-Reset` (Unix seconds), also measured against `Date`. `header` looks a
 * header up by its lower-case name.
 */
export function retryAfter(header: (name: string) => string | undefined): number | undefined {
  const now = Date.parse(header('date') ?? '')
  const value = header('retry-after')
  if (value) {
    if (/^\d+$/.test(value)) return Number(value) * 1000
    const at = Date.parse(value)
    return Number.isNaN(at) || Number.isNaN(now) ? undefined : Math.max(0, at - now)
  }
  const reset = header('ratelimit-reset')
  if (!reset || !/^\d+$/.test(reset) || Number.isNaN(now)) return undefined
  return Math.max(0, Number(reset) * 1000 - now)
}

/** Replaces every occurrence of a secret in text, so it can be shown, logged or posted. */
export function redact(text: string, secret: string | null | undefined): string {
  if (!secret) return text
  return text.split(secret).join('[token]')
}

/** The error with the secret redacted from its message, keeping its kind and details. */
export function redactError(error: unknown, secret: string | null | undefined): unknown {
  if (!secret || !(error instanceof Error) || !error.message.includes(secret)) return error
  const message = redact(error.message, secret)
  if (error instanceof GitLabError) {
    return new GitLabError(error.kind, message, {
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      ...(error.reason === undefined ? {} : { reason: error.reason })
    })
  }
  return new Error(message)
}
