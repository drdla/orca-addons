// The panel's search: a case-insensitive "contains" match on a card's MR URL and title. Pure; the
// panel narrows every tab with it. A pasted GitLab link is first cut back to `…/merge_requests/<n>`,
// so a link to the MR's diffs, a note or with a query string still finds its card. Only what the
// panel already has is searched: Review Requests the filter settings hide never reach it.

/** What the cards are matched against: trimmed, lower-case, a merge request link cut to its MR. */
export function normalizeQuery(query: string): string {
  const text = query.trim().toLowerCase()
  const mergeRequest = /\/merge_requests\/\d+/.exec(text)
  return mergeRequest === null ? text : text.slice(0, mergeRequest.index + mergeRequest[0].length)
}

/** Whether a card matches the (normalized) query; an empty query matches every card. */
export function matchesQuery(card: { url: string; title: string }, normalized: string): boolean {
  if (normalized === '') return true
  return card.url.toLowerCase().includes(normalized) || card.title.toLowerCase().includes(normalized)
}

/**
 * The tab to switch to while searching: when the selected tab has no match and exactly one other
 * tab does, that one; otherwise the selected tab stays.
 */
export function tabWithMatches<T extends string>(matches: Readonly<Record<T, number>>, selected: NoInfer<T>): T {
  if (matches[selected] > 0) return selected
  const withMatches = (Object.keys(matches) as T[]).filter((tab) => matches[tab] > 0)
  return withMatches.length === 1 ? withMatches[0] : selected
}
