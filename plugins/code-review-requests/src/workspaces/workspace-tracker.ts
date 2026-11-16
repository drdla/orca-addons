// The worker's view of Orca's workspaces: one `orca worktree list` per poll (#7), plus one
// `orca worktree ps` for their agents while any workspace is linked to an MR (#10), kept until
// the next poll, and what it adds to each panel card (its Review Workspace, its Agent Review, or
// why Start review can't run). A failing CLI only disables these workspace features, never the
// poll (#15); a failing `ps` only drops the Agent Review line.
import { messageOf } from '../errors'
import type { AgentReviewView, ReviewRequestCard, ReviewRequestsSnapshot } from '../protocol'
import type { OrcaCli, WorktreeAgent } from '../seams/orca-cli'
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
  /** `agents`: by worktree id, from `orca worktree ps`; empty when it failed or wasn't asked. */
  | { kind: 'listed'; index: WorkspaceIndex; agents: Map<string, WorktreeAgent[]> }
  /** The last `orca worktree list` failed; `reason` says why. */
  | { kind: 'unavailable'; reason: string }

export type WorkspaceTracker = {
  current(): WorkspaceState
  /** Lists the worktrees again. Never rejects: a failure becomes the `unavailable` state. */
  refresh(): Promise<WorkspaceState>
}

export function createWorkspaceTracker(cli: () => OrcaCli, log: (message: string) => void): WorkspaceTracker {
  let state: WorkspaceState = { kind: 'unknown' }

  async function agentsOf(index: WorkspaceIndex): Promise<Map<string, WorktreeAgent[]>> {
    const agents = new Map<string, WorktreeAgent[]>()
    if (index.byUrl.size === 0 && !index.worktrees.some((w) => w.linkedGitLabMR !== null)) return agents
    try {
      for (const row of await cli().listAgents()) agents.set(row.worktreeId, row.agents)
    } catch (error) {
      log(`orca worktree ps failed: ${messageOf(error)}`)
    }
    return agents
  }

  return {
    current: () => state,
    async refresh() {
      try {
        const index = workspaceIndexOf(await cli().listWorktrees())
        state = { kind: 'listed', index, agents: await agentsOf(index) }
      } catch (error) {
        const reason = messageOf(error)
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

/** A Review Draft's counts (#29, #30): unposted Review Comments, and the checked ones that post. */
export type DraftCounts = { unposted: number; toPost: number }

/** The snapshot with each card's Review Workspace, Agent Review and Start review hint filled in. */
export function withWorkspaces(
  snapshot: ReviewRequestsSnapshot,
  state: WorkspaceState,
  drafts: (url: string) => DraftCounts = () => ({ unposted: 0, toPost: 0 })
): ReviewRequestsSnapshot {
  return { ...snapshot, reviewRequests: snapshot.reviewRequests.map((card) => decorate(card, state, drafts)) }
}

function decorate(
  card: ReviewRequestCard,
  state: WorkspaceState,
  drafts: (url: string) => DraftCounts
): ReviewRequestCard {
  const none = { workspace: null, agentReview: null, toPost: 0 }
  if (state.kind === 'unknown') return { ...card, ...none, startBlocked: null }
  if (state.kind === 'unavailable') {
    return { ...card, ...none, startBlocked: `Workspaces are unavailable: ${state.reason}` }
  }
  const worktree = findReviewWorkspace(state.index, card)
  const startBlocked = findRepo(state.index, card) ? null : `Add ${card.projectPath} to Orca to review here.`
  if (!worktree) return { ...card, ...none, startBlocked }
  const counts = drafts(card.url)
  return {
    ...card,
    workspace: { id: worktree.id, name: worktree.displayName, path: worktree.path },
    startBlocked,
    agentReview: agentReviewOf(state.agents.get(worktree.id) ?? [], counts.unposted),
    toPost: counts.toPost
  }
}

/** Running while any agent works (or waits for permission); done once every one has finished. */
function agentReviewOf(agents: WorktreeAgent[], commentsReady: number): AgentReviewView | null {
  if (agents.length === 0) return null
  const running = agents.some((a) => a.state === 'working' || a.state === 'blocked')
  return { state: running ? 'running' : 'done', commentsReady }
}
