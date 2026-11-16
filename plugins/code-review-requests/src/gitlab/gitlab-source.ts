// The worker's way into GitLab: one transport and username per connection, rebuilt when the
// connection's identity changes (connection-key.ts), for the Review Requests list (#20, #21) and
// the reasons dropped ones dropped off (#7).
import { connectionKeyOf, type ConnectionKey } from '../connection-key'
import type { Deps } from '../deps'
import { explainDropped } from '../notify/explain-dropped'
import type { ReviewRequestView } from '../protocol'
import type { GitLabConnection, GitLabTransport } from '../seams/gitlab'
import { fetchReviewRequests, fetchUsername } from './fetch-review-requests'
import { createRequestedAtCache } from './requested-at'

export function createGitLabSource(deps: Pick<Deps, 'gitLab'>) {
  let cached: { key: ConnectionKey; transport: GitLabTransport; me: string | null } | null = null
  const requestedAt = createRequestedAtCache()

  async function sourceFor(connection: GitLabConnection) {
    const key = connectionKeyOf(connection)
    if (cached?.key !== key) cached = { key, transport: deps.gitLab(connection), me: null }
    const source = cached
    source.me ??= await fetchUsername(source.transport)
    return { transport: source.transport, me: source.me }
  }

  return {
    async reviewRequests(connection: GitLabConnection): Promise<ReviewRequestView[]> {
      const { transport, me } = await sourceFor(connection)
      return requestedAt.apply(transport, me, await fetchReviewRequests(transport, me))
    },
    async explainDropped(connection: GitLabConnection, dropped: ReviewRequestView[]) {
      const { transport, me } = await sourceFor(connection)
      return explainDropped(transport, me, dropped)
    }
  }
}
