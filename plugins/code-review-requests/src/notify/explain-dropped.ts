// Why did a Review Request drop off the list? The list query can't say (it only returns what is
// still waiting), so ask GitLab about each dropped MR with one small GraphQL query (#7): state,
// draft, approvedBy and reviewers. Made draft is not an Ended Review Request, so the
// notifications must tell it apart from approved, merged, closed and removed as Reviewer.
//
// An MR GitLab no longer shows the user (deleted, access lost: a null project or merge request,
// or a 403/404) is 'not-visible'. That is not an Ended Review Request either: we can't tell
// whether the review is over, so it notifies once, neutrally, and never gets an Ended entry or
// auto-removal. Anything else that fails (offline, 5xx, a GraphQL error) leaves the reason
// unknown, and the notifier asks again on the next good poll.
import type { ReviewRequestView } from '../protocol'
import { GitLabError, type GitLabTransport } from '../seams/gitlab'
import type { DropReason } from './changes'

export const DROPPED_MERGE_REQUEST_QUERY = `query DroppedMergeRequest($project: ID!, $iid: String!) {
  project(fullPath: $project) {
    mergeRequest(iid: $iid) {
      state
      draft
      approvedBy { nodes { username } }
      reviewers { nodes { username } }
    }
  }
}`

export type DroppedMergeRequestNode = {
  state: 'opened' | 'closed' | 'locked' | 'merged'
  draft: boolean
  approvedBy: { nodes: { username: string }[] }
  reviewers: { nodes: { username: string }[] }
}

export type DroppedMergeRequestResponse = {
  project: { mergeRequest: DroppedMergeRequestNode | null } | null
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
      const data = await transport.graphql<DroppedMergeRequestResponse>(DROPPED_MERGE_REQUEST_QUERY, {
        project: r.projectPath,
        iid: String(r.iid)
      })
      const mr = data?.project?.mergeRequest ?? null
      const reason = mr === null ? 'not-visible' : reasonOf(mr, me)
      if (reason !== null) reasons.set(r.url, reason)
    } catch (error) {
      if (isNotVisible(error)) reasons.set(r.url, 'not-visible')
    }
  }
  return reasons
}

function isNotVisible(error: unknown): boolean {
  return error instanceof GitLabError && error.kind === 'rejected' && (error.status === 403 || error.status === 404)
}

/** Null when the answer still looks like a Review Request (a race with the list): ask again. */
function reasonOf(mr: DroppedMergeRequestNode, me: string): DropReason | null {
  if (mr.state === 'merged') return 'merged'
  if (mr.state !== 'opened') return 'closed'
  if (mr.approvedBy.nodes.some((u) => u.username === me)) return 'approved'
  if (!mr.reviewers.nodes.some((u) => u.username === me)) return 'unassigned'
  if (mr.draft) return 'draft'
  return null
}
