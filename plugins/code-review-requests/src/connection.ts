// Which GitLab to poll, and how (#8). The instanceUrl setting is the single source of truth for
// the host. A token stored in secrets under `token:<host>` means token mode (#25), so changing the
// instance URL never sends a token to another server; otherwise glab, never a silent fallback.
import { GitLabError, type GitLabConnection } from './seams/gitlab'
import type { Settings } from './settings'

/** The host part of the instance URL, as `glab --hostname` takes it. */
export function hostOf(instanceUrl: string): string {
  let url: URL
  try {
    url = new URL(instanceUrl.includes('://') ? instanceUrl : `https://${instanceUrl}`)
  } catch {
    throw new GitLabError('needs-you', `The GitLab instance URL "${instanceUrl}" is not a URL.`, {
      reason: 'bad-url'
    })
  }
  return url.host
}

/** Where the token for a host lives in the plugin's secrets. Never in settings or storage. */
export function tokenKey(host: string): string {
  return `token:${host}`
}

export type SecretsSource = { get(key: string): Promise<string | null> }

/** The connection for the settings; without `secrets` (or without a stored token) it is glab. */
export async function connectionFor(settings: Settings, secrets?: SecretsSource): Promise<GitLabConnection> {
  const host = hostOf(settings.instanceUrl)
  const token = secrets ? ((await secrets.get(tokenKey(host)))?.trim() ?? '') : ''
  return { host, token: token === '' ? null : token }
}
