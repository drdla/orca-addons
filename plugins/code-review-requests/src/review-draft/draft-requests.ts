// The Review Draft's panel requests (#29): `rr.draft` imports and answers a draft,
// `rr.updateDraftComment` and `rr.deleteDraftComment` curate it. worker.ts calls registerDraftRequests once in activate.
import type { OrcaWorkerApi } from 'orca/worker'
import type { Deps } from '../deps'
import type { ReviewRequestCard } from '../protocol'
import type { WorkspaceState } from '../workspaces/workspace-tracker'
import { createDraftImport, DraftChangeError, type DraftTarget } from './draft-import'
import { createReviewDrafts } from './review-drafts'

export function registerDraftRequests(
  orca: OrcaWorkerApi,
  options: {
    deps: Deps
    /** The cards as the panel has them (with their Review Workspace). */
    cards: () => ReviewRequestCard[]
    workspaceState: () => WorkspaceState
    /** After a Review Draft changed. */
    onChanged?: () => Promise<void>
  }
): DraftRequests {
  const { deps } = options
  const drafts = createReviewDrafts(orca.storage, deps.clock)
  const draftImport = createDraftImport({ drafts, cli: deps.orcaCli, git: deps.git, files: deps.files, clock: deps.clock })

  function targetOf(url: string): DraftTarget {
    const card = options.cards().find((c) => c.url === url)
    if (!card) throw new DraftChangeError(`${url} is not a Review Request any more.`)
    const state = options.workspaceState()
    return {
      url,
      iid: card.iid,
      title: card.title,
      author: card.author,
      ...(card.authorName ? { authorName: card.authorName } : {}),
      workspace: card.workspace ?? null,
      workspaceProblem: state.kind === 'unavailable' ? `Workspaces are unavailable: ${state.reason}` : null
    }
  }

  /** Runs a request, then tells open panels (the card's counts follow the Review Draft, #10). */
  async function thenChanged<T>(result: Promise<T>): Promise<T> {
    const answer = await result
    await options.onChanged?.()
    return answer
  }

  orca.panels.handle('rr.draft', async ({ url }) => thenChanged(draftImport.open(targetOf(url))))
  orca.panels.handle('rr.updateDraftComment', async ({ url, ...change }) =>
    thenChanged(draftImport.change(targetOf(url), change))
  )
  orca.panels.handle('rr.deleteDraftComment', async ({ url, id }) => thenChanged(draftImport.remove(targetOf(url), id)))
  return {
    async workspaceMoved(url, from) {
      await drafts.noteWrittenAt(url, from)
      // A draft the reviewer has: bring it up to date now. None: the next import applies `from`,
      // so Update workspace never creates one (it would change card counts and removal checks).
      if ((await drafts.get(url)) !== null) await draftImport.open(targetOf(url))
    }
  }
}

export type DraftRequests = {
  /**
   * Update workspace moved the Review Workspace away from commit `from` (#58): the diff-view
   * notes and findings not yet in the Review Draft were written against it, so the draft can tell
   * which of them may be outdated.
   */
  workspaceMoved(url: string, from: string): Promise<void>
}
