// When the user was added as Reviewer, which is when a Review Request starts waiting (#10). The
// GraphQL query has no such field, so it comes from REST `GET …/merge_requests/:iid/reviewers`
// (`created_at` of the user's row, captured in src/fixtures/gitlab-reviewers-capture.ts). It
// never changes while the user stays a Reviewer, so each Review Request is asked about once; a
// failed ask keeps the MR's creation time and is retried on the next poll.
import type { ReviewRequestView } from '../protocol'
import type { GitLabTransport } from '../seams/gitlab'

type ReviewerRow = { user: { username: string }; created_at: string }

export function createRequestedAtCache() {
  let known = new Map<string, number>()

  async function ask(transport: GitLabTransport, me: string, view: ReviewRequestView) {
    const path = `/projects/${encodeURIComponent(view.projectPath)}/merge_requests/${view.iid}/reviewers`
    const rows = await transport.rest<ReviewerRow[]>('GET', path)
    const at = Date.parse(rows.find((row) => row.user.username === me)?.created_at ?? '')
    return Number.isNaN(at) ? null : at
  }

  return {
    /** The views with `requestedAt` filled in. Forgets Review Requests that left the list. */
    async apply(transport: GitLabTransport, me: string, views: ReviewRequestView[]) {
      const next = new Map<string, number>()
      const result: ReviewRequestView[] = []
      for (const view of views) {
        let at = known.get(view.url) ?? null
        if (at === null) at = await ask(transport, me, view).catch(() => null)
        if (at !== null) next.set(view.url, at)
        result.push(at === null ? view : { ...view, requestedAt: at })
      }
      known = next
      return result
    }
  }
}
