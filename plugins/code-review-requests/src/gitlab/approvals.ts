// The approvals badge (#10), `given/required`, from a separate, optional query. GitLab CE may not
// know `approvalsRequired`/`approvalsLeft` (merge request approval rules are an EE feature), so
// they stay out of the Review Requests list query: an unknown field there would fail every poll.
// Here any failure only hides the badge; a refused query (unknown field) is not asked again for
// the same connection.
import { GitLabError, type GitLabTransport } from '../seams/gitlab'

export const REVIEW_REQUEST_APPROVALS_QUERY = `query ReviewRequestApprovals($me: String!, $after: String) {
  currentUser {
    reviewRequestedMergeRequests(
      state: opened
      draft: false
      not: { approvedBy: [$me] }
      sort: UPDATED_DESC
      first: 100
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { webUrl approvalsRequired approvalsLeft }
    }
  }
}`

export type ApprovalsNode = { webUrl: string; approvalsRequired: number | null; approvalsLeft: number | null }

export type ApprovalsResponse = {
  currentUser: {
    reviewRequestedMergeRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: ApprovalsNode[]
    }
  }
}

export type Approvals = { given: number; required: number }

/** `given/required`, with given = required - left; null when the MR requires none. */
export function approvalsOf(node: Pick<ApprovalsNode, 'approvalsRequired' | 'approvalsLeft'>): Approvals | null {
  const required = node.approvalsRequired ?? 0
  if (required <= 0) return null
  const left = Math.max(0, Math.min(required, node.approvalsLeft ?? required))
  return { given: required - left, required }
}

/** Asks for the approvals per MR URL; remembers when this GitLab can't answer (CE). */
export function createApprovalsReader(transport: GitLabTransport) {
  let unavailable = false
  return {
    /** By MR web URL; null when they couldn't be read this time (or ever, on this GitLab). */
    async read(me: string): Promise<Map<string, Approvals | null> | null> {
      if (unavailable) return null
      const byUrl = new Map<string, Approvals | null>()
      let after: string | null = null
      try {
        for (;;) {
          const variables: Record<string, string> = after === null ? { me } : { me, after }
          const data = await transport.graphql<ApprovalsResponse>(REVIEW_REQUEST_APPROVALS_QUERY, variables)
          const page = data.currentUser.reviewRequestedMergeRequests
          for (const node of page.nodes) byUrl.set(node.webUrl, approvalsOf(node))
          if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return byUrl
          after = page.pageInfo.endCursor
        }
      } catch (error) {
        // A refused query (GraphQL: unknown field) won't work next time either.
        if (error instanceof GitLabError && error.kind === 'rejected') unavailable = true
        return null
      }
    }
  }
}
