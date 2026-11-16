// Why did a Review Request drop off the list? The list query can't say (it only returns what is
// still waiting), so ask GitLab about each dropped MR. Made draft is not an Ended Review Request,
// so the notifications must tell it apart from approved, merged, closed and removed as Reviewer.
import type { ReviewRequestView } from '../protocol'
import { GitLabError, type GitLabTransport } from '../seams/gitlab'
import type { DropReason } from './changes'

type MergeRequest = {
  state: 'opened' | 'closed' | 'locked' | 'merged'
  draft: boolean
  reviewers: { username: string }[]
}

/** One reason per URL; an MR whose lookup failed for now is left out, to be asked about again. */
export async function explainDropped(
  transport: GitLabTransport,
  me: string,
  dropped: ReviewRequestView[]
): Promise<Map<string, DropReason>> {
  const reasons = new Map<string, DropReason>()
  for (const r of dropped) {
    try {
      const path = `/projects/${encodeURIComponent(r.projectPath)}/merge_requests/${r.iid}`
      reasons.set(r.url, reasonOf(await transport.rest<MergeRequest>('GET', path), me))
    } catch (error) {
      // GitLab refused for good (404, lost access): it's gone, which ends it. Anything else
      // (offline, set-up trouble) is unknown for now; the notifier asks again next good poll.
      if (error instanceof GitLabError && error.kind === 'rejected') reasons.set(r.url, 'gone')
    }
  }
  return reasons
}

function reasonOf(mr: MergeRequest, me: string): DropReason {
  if (mr.state === 'merged') return 'merged'
  if (mr.state !== 'opened') return 'closed'
  if (!mr.reviewers.some((r) => r.username === me)) return 'unassigned'
  if (mr.draft) return 'draft'
  return 'approved'
}
