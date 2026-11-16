// The one GraphQL query that lists the user's Review Requests (#5). Needs GitLab 17.4+ for
// `not: { approvedBy }`; callers should still drop nodes where their own reviewer node says
// `approved: true`, because `not` is marked experimental.

export const REVIEW_REQUESTS_QUERY = `query ReviewRequests($me: String!, $after: String) {
  currentUser {
    username
    reviewRequestedMergeRequests(
      state: opened
      draft: false
      not: { approvedBy: [$me] }
      sort: UPDATED_DESC
      first: 100
      after: $after
    ) {
      count
      pageInfo { hasNextPage endCursor }
      nodes {
        id iid title webUrl draft state createdAt updatedAt
        sourceBranch targetBranch
        diffRefs { baseSha headSha startSha }
        project { fullPath group { fullPath } }
        author { username name }
        labels { nodes { title } }
        reviewers { nodes { username mergeRequestInteraction { reviewState approved reviewed } } }
      }
    }
  }
}`

export type ReviewState =
  | 'UNREVIEWED'
  | 'REVIEWED'
  | 'REQUESTED_CHANGES'
  | 'APPROVED'
  | 'UNAPPROVED'
  | 'REVIEW_STARTED'

export type ReviewRequestNode = {
  /** Global id, `gid://gitlab/MergeRequest/<n>`. */
  id: string
  /** GitLab sends the iid as a string. */
  iid: string
  title: string
  webUrl: string
  draft: boolean
  state: 'opened' | 'closed' | 'locked' | 'merged'
  createdAt: string
  updatedAt: string
  sourceBranch: string
  targetBranch: string
  diffRefs: { baseSha: string; headSha: string; startSha: string } | null
  project: { fullPath: string; group: { fullPath: string } | null }
  author: { username: string; name: string }
  labels: { nodes: { title: string }[] }
  reviewers: {
    nodes: {
      username: string
      mergeRequestInteraction: { reviewState: ReviewState; approved: boolean; reviewed: boolean } | null
    }[]
  }
}

export type ReviewRequestsResponse = {
  currentUser: {
    username: string
    reviewRequestedMergeRequests: {
      count: number
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: ReviewRequestNode[]
    }
  }
}
