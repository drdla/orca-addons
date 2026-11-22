// Who wrote a Review Request, as people read it; shared by the worker and the panel (no imports
// beyond types, so both can load it).
import type { ReviewRequestView } from './protocol'

/** The author's display name, or their username when GitLab gave none (or the view predates it). */
export function authorNameOf(r: Pick<ReviewRequestView, 'author' | 'authorName'>): string {
  return r.authorName?.trim() || r.author
}
