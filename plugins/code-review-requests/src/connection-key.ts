// The identity of a GitLab connection (#8, #25): the worker rebuilds its transport, re-polls and
// the Connection section re-checks when it changes. Worker-only (node:crypto). The token goes in
// as a SHA-256 fingerprint, so a key can sit in maps, logs or errors without leaking it.
import { createHash } from 'node:crypto'
import type { GitLabConnection } from './seams/gitlab'

/** A connection's identity: host, token fingerprint and glab path. Never the token itself. */
export type ConnectionKey = string & { readonly __brand: 'ConnectionKey' }

/** The key for a connection; null (no valid instance URL) has a key of its own. */
export function connectionKeyOf(connection: GitLabConnection | null): ConnectionKey {
  if (connection === null) return 'none' as ConnectionKey
  const source =
    connection.token === null
      ? `glab:${connection.glabPath ?? ''}`
      : `token:${createHash('sha256').update(connection.token).digest('hex').slice(0, 16)}`
  return `${connection.host}|${source}` as ConnectionKey
}
