// The worker's view of Orca's workspaces: one `orca worktree list` per poll (#7), kept until the
// next one, and what it adds to each panel card (its Review Workspace, or why Start review can't
// run). A failing CLI only disables these workspace features, never the poll (#15).
import type { ReviewRequestCard, ReviewRequestsSnapshot } from '../protocol'
import type { OrcaCli } from '../seams/orca-cli'
import {
  findRepo,
  findReviewWorkspace,
  hasReviewWorkspace,
  workspaceIndexOf,
  type MergeRequestRef,
  type WorkspaceIndex
} from './review-workspaces'

export type WorkspaceState =
  /** No list yet (nothing polled). */
  | { kind: 'unknown' }
  | { kind: 'listed'; index: WorkspaceIndex }
  /** The last `orca worktree list` failed; `reason` says why. */
  | { kind: 'unavailable'; reason: string }

export type WorkspaceTracker = {
  current(): WorkspaceState
  /** Lists the worktrees again. Never rejects: a failure becomes the `unavailable` state. */
  refresh(): Promise<WorkspaceState>
}

export function createWorkspaceTracker(cli: () => OrcaCli, log: (message: string) => void): WorkspaceTracker {
  let state: WorkspaceState = { kind: 'unknown' }
  return {
    current: () => state,
    async refresh() {
      try {
        state = { kind: 'listed', index: workspaceIndexOf(await cli().listWorktrees()) }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        log(`orca worktree list failed: ${reason}`)
        state = { kind: 'unavailable', reason }
      }
      return state
    }
  }
}

/**
 * Does this Review Request have a Review Workspace, by the last list? The filters' exception (#26).
 * False while the CLI is unavailable or nothing was listed yet.
 */
export function hasWorkspace(state: WorkspaceState, mr: MergeRequestRef): boolean {
  return state.kind === 'listed' && hasReviewWorkspace(state.index, mr)
}

/** The snapshot with each card's Review Workspace and Start review hint filled in. */
export function withWorkspaces(snapshot: ReviewRequestsSnapshot, state: WorkspaceState): ReviewRequestsSnapshot {
  return { ...snapshot, reviewRequests: snapshot.reviewRequests.map((card) => decorate(card, state)) }
}

function decorate(card: ReviewRequestCard, state: WorkspaceState): ReviewRequestCard {
  if (state.kind === 'unknown') return { ...card, workspace: null, startBlocked: null }
  if (state.kind === 'unavailable') {
    return { ...card, workspace: null, startBlocked: `Workspaces are unavailable: ${state.reason}` }
  }
  const worktree = findReviewWorkspace(state.index, card)
  return {
    ...card,
    workspace: worktree && { id: worktree.id, name: worktree.displayName, path: worktree.path },
    startBlocked: findRepo(state.index, card) ? null : `Add ${card.projectPath} to Orca to review here.`
  }
}
