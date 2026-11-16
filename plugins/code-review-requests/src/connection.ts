// Which GitLab to poll, and how (#8). The instanceUrl setting is the single source of truth for
// the host. Token mode (#25) fills `token` from secrets per host; until then it is always glab.
import { GitLabError, type GitLabConnection } from './seams/gitlab'
import type { Settings } from './settings'

/** The host part of the instance URL, as `glab --hostname` takes it. */
export function hostOf(instanceUrl: string): string {
  let url: URL
  try {
    url = new URL(instanceUrl.includes('://') ? instanceUrl : `https://${instanceUrl}`)
  } catch {
    throw new GitLabError('needs-you', `The GitLab instance URL "${instanceUrl}" is not a URL.`)
  }
  return url.host
}

export async function connectionFor(settings: Settings): Promise<GitLabConnection> {
  return { host: hostOf(settings.instanceUrl), token: null }
}
