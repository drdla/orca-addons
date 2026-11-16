// The Review Draft's panel requests (#29): `rr.draft` imports and answers a draft,
// `rr.updateDraftComment` curates it. worker.ts calls registerDraftRequests once in activate.
import type { OrcaWorkerApi } from 'orca/worker'
import type { Deps } from '../deps'
import type { ReviewRequestCard } from '../protocol'
import type { WorkspaceState } from '../workspaces/workspace-tracker'
import { createDraftImport, DraftChangeError, type DraftTarget } from './draft-import'
import { createReviewDrafts, type ReviewDrafts } from './review-drafts'

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
): ReviewDrafts {
  const { deps } = options
  const drafts = createReviewDrafts(orca.storage, deps.clock)
  const draftImport = createDraftImport({ drafts, cli: deps.orcaCli, git: deps.git, files: deps.files, clock: deps.clock })

  function targetOf(url: string): DraftTarget {
    const card = options.cards().find((c) => c.url === url)
    if (!card) throw new DraftChangeError(`${url} is not a Review Request any more.`)
    const state = options.workspaceState()
    return {
      url,
      title: card.title,
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
  return drafts
}
