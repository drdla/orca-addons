// Reads the user's Review Requests from GitLab through the transport seam: who am I, then every
// page of the Review Requests query, mapped to the views the rest of the plugin uses.
import type { CiStatus, ReviewRequestView } from '../protocol'
import type { GitLabTransport } from '../seams/gitlab'
import {
  REVIEW_REQUESTS_QUERY,
  type PipelineStatus,
  type ReviewRequestNode,
  type ReviewRequestsResponse
} from './review-requests-query'
import { explainRefusedQuery } from './version-check'

/** The logged-in user's username, which the query needs as `$me`. */
export async function fetchUsername(transport: GitLabTransport): Promise<string> {
  const user = await transport.rest<{ username: string }>('GET', '/user')
  return user.username
}

/** Every Review Request of `me`, following the query's pages. */
export async function fetchReviewRequests(
  transport: GitLabTransport,
  me: string
): Promise<ReviewRequestView[]> {
  const views: ReviewRequestView[] = []
  let after: string | null = null
  for (;;) {
    const variables: Record<string, string> = after === null ? { me } : { me, after }
    let data: ReviewRequestsResponse
    try {
      data = await transport.graphql<ReviewRequestsResponse>(REVIEW_REQUESTS_QUERY, variables)
    } catch (error) {
      throw await explainRefusedQuery(transport, error)
    }
    const page = data.currentUser.reviewRequestedMergeRequests
    for (const node of page.nodes) {
      if (isReviewRequest(node, me)) views.push(toView(node))
    }
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return views
    after = page.pageInfo.endCursor
  }
}

/**
 * The query already filters these out, but `not: { approvedBy }` is experimental, so check the
 * user's own reviewer node too (research #5).
 */
function isReviewRequest(node: ReviewRequestNode, me: string): boolean {
  if (node.draft || node.state !== 'opened') return false
  const mine = node.reviewers.nodes.find((r) => r.username === me)
  return mine?.mergeRequestInteraction?.approved !== true
}

function toView(node: ReviewRequestNode): ReviewRequestView {
  return {
    url: node.webUrl,
    title: node.title,
    projectPath: node.project.fullPath,
    iid: Number(node.iid),
    author: node.author.username,
    // Until withRequestedAt() knows better: the earliest the user can have been added.
    requestedAt: Date.parse(node.createdAt),
    sourceBranch: node.sourceBranch,
    targetBranch: node.targetBranch,
    mergeRequestHead: node.diffRefs?.headSha ?? null,
    ci: ciOf(node.headPipeline?.status ?? null),
    // Filled in from the optional approvals query (approvals.ts), which CE may not answer.
    approvals: null,
    comments: node.userNotesCount ?? 0
  }
}

/** Passed, failed or running; nothing for no pipeline or one that was canceled, skipped or manual. */
function ciOf(status: PipelineStatus | null): CiStatus | null {
  switch (status) {
    case 'SUCCESS':
      return 'passed'
    case 'FAILED':
      return 'failed'
    case 'CREATED':
    case 'WAITING_FOR_RESOURCE':
    case 'PREPARING':
    case 'WAITING_FOR_CALLBACK':
    case 'PENDING':
    case 'RUNNING':
    case 'SCHEDULED':
      return 'running'
    default:
      return null
  }
}
