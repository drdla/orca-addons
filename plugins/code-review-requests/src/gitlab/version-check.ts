// The Review Requests query needs GitLab 17.4+ (research #5). An older instance refuses the query
// (the field is missing), which looks like any other refused request; asking `GET /version` tells
// "too old" (Needs you, #15) apart from a refusal worth retrying.
import { GitLabError, type GitLabTransport } from '../seams/gitlab'

export const MINIMUM_GITLAB = { major: 17, minor: 4 }

/**
 * Called with the error a refused Review Requests query raised. Resolves with a Needs-you error
 * when the instance is older than 17.4, otherwise with the original error (also when the version
 * can't be read).
 */
export async function explainRefusedQuery(transport: GitLabTransport, error: unknown): Promise<unknown> {
  if (!(error instanceof GitLabError) || error.kind !== 'rejected') return error
  let version: string
  try {
    version = (await transport.rest<{ version: string }>('GET', '/version')).version
  } catch {
    return error
  }
  const match = /^(\d+)\.(\d+)/.exec(version)
  if (!match) return error
  const [major, minor] = [Number(match[1]), Number(match[2])]
  const tooOld = major < MINIMUM_GITLAB.major || (major === MINIMUM_GITLAB.major && minor < MINIMUM_GITLAB.minor)
  if (!tooOld) return error
  return new GitLabError('needs-you', `Needs GitLab 17.4+, this instance runs ${version}`, {
    reason: 'gitlab-too-old'
  })
}
