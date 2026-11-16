// The worker's way into GitLab: one transport and username per connection, rebuilt when the
// connection's identity changes (connection-key.ts), for the Review Requests list (#20, #21) and
// the reasons dropped ones dropped off (#7).
import { connectionKeyOf, type ConnectionKey } from '../connection-key'
import type { Deps } from '../deps'
import { explainDropped } from '../notify/explain-dropped'
import type { ReviewRequestView } from '../protocol'
import type { GitLabConnection, GitLabTransport } from '../seams/gitlab'
import { createApprovalsReader } from './approvals'
import { fetchReviewRequests, fetchUsername } from './fetch-review-requests'

type ApprovalsReader = ReturnType<typeof createApprovalsReader>
import { createRequestedAtCache } from './requested-at'

export function createGitLabSource(deps: Pick<Deps, 'gitLab'>) {
  type Source = { key: ConnectionKey; transport: GitLabTransport; me: string | null; approvals: ApprovalsReader }
  let cached: Source | null = null
  const requestedAt = createRequestedAtCache()

  async function sourceFor(connection: GitLabConnection) {
    const key = connectionKeyOf(connection)
    if (cached?.key !== key) {
      const transport = deps.gitLab(connection)
      cached = { key, transport, me: null, approvals: createApprovalsReader(transport) }
    }
    const source = cached
    source.me ??= await fetchUsername(source.transport)
    return { transport: source.transport, me: source.me, approvals: source.approvals }
  }

  return {
    /** The list; the approvals badge only where GitLab could say (never fails the list). */
    async reviewRequests(connection: GitLabConnection): Promise<ReviewRequestView[]> {
      const { transport, me, approvals } = await sourceFor(connection)
      const views = await requestedAt.apply(transport, me, await fetchReviewRequests(transport, me))
      const byUrl = await approvals.read(me)
      return views.map((view) => ({ ...view, approvals: byUrl?.get(view.url) ?? null }))
    },
    async explainDropped(connection: GitLabConnection, dropped: ReviewRequestView[]) {
      const { transport, me } = await sourceFor(connection)
      return explainDropped(transport, me, dropped)
    }
  }
}
