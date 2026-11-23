// The posting requests (#30): `rr.postPreview` (the confirm step), `rr.postReview` and
// `rr.deleteFailedDrafts`. worker.ts calls registerPostRequests once in activate.
import type { OrcaWorkerApi } from 'orca/worker'
import type { ReviewRequestCard } from '../protocol'
import { DraftChangeError, viewOf } from './draft-import'
import type { GitLabAccess } from '../seams/gitlab'
import { createReviewPoster } from './post-review'
import { emptyDraft, type ReviewDrafts } from './review-drafts'

export function registerPostRequests(
  orca: OrcaWorkerApi,
  options: {
    drafts: ReviewDrafts
    /** The cards a Review Draft can belong to (Review Requests and Ended ones). */
    cards: () => ReviewRequestCard[]
    connection: () => Promise<GitLabAccess>
    /** After posting or deleting failed drafts changed a Review Draft. */
    onChanged?: () => Promise<void>
    /**
     * After GitLab accepted an approval or a request for changes (#78): polls at once, so the
     * Review Request ends (Done) now instead of at the next interval.
     */
    onEnded?: () => Promise<void>
  }
): void {
  const { drafts } = options
  const poster = createReviewPoster({
    drafts,
    connection: options.connection,
    notify: (title, body) => orca.host.call('notifications.show', { title, body })
  })

  function cardOf(url: string): ReviewRequestCard {
    const card = options.cards().find((c) => c.url === url)
    if (!card) throw new DraftChangeError(`${url} is not a Review Request any more.`)
    return card
  }

  async function draftView(card: ReviewRequestCard) {
    const draft = (await drafts.get(card.url)) ?? emptyDraft(card.url)
    return viewOf(draft, {
      url: card.url,
      iid: card.iid,
      title: card.title,
      author: card.author,
      ...(card.authorName ? { authorName: card.authorName } : {}),
      workspace: card.workspace ?? null
    })
  }

  orca.panels.handle('rr.postPreview', async ({ url }) => poster.preview(cardOf(url)))
  orca.panels.handle('rr.postReview', async ({ url, summary, outcome }) => {
    const card = cardOf(url)
    const result = await poster.post(card, { summary, outcome })
    const ended = outcome === 'requested_changes' || (outcome === 'approve' && result.approveError === null)
    if (ended) await options.onEnded?.()
    await options.onChanged?.()
    return { ...result, draft: await draftView(card) }
  })
  orca.panels.handle('rr.deleteFailedDrafts', async ({ url }) => {
    const card = cardOf(url)
    await poster.deleteFailedDrafts(card)
    await options.onChanged?.()
    return draftView(card)
  })
}
