// What the panel's workspace buttons do (#6, #27): Start review (create the Review Workspace
// through the orca CLI, linked to the MR, optionally followed by an Agent Review), Open workspace
// and Run Agent Review. Every failure rejects with a message the panel shows on the card.
//
// The orca CLI and the host API name workspaces differently (`<repoId>::<path>` vs the id
// `workspace.list` gives), so host calls map a worktree to its host id by path.
import type { OrcaWorkerApi } from 'orca/worker'
import type { ReviewRequestView } from '../protocol'
import type { Worktree } from '../seams/orca-cli'
import type { Settings } from '../settings'
import { reviewCommandFor, reviewPromptFor } from './review-prompt'
import { findRepo, findReviewWorkspace } from './review-workspaces'
import type { WorkspaceContext } from './workspace-context'
import type { WorkspaceState } from './workspace-tracker'
import { messageOf } from '../errors'

export type ReviewActionsDeps = WorkspaceContext & {
  settings: () => Promise<Settings>
  /** The listed Review Request with this URL, if any. */
  reviewRequest: (url: string) => ReviewRequestView | undefined
}

export type ReviewActions = {
  /** Creates (or reuses) the Review Workspace, then starts an Agent Review if `withAgent`. */
  startReview(url: string, withAgent: boolean): Promise<void>
  openWorkspace(url: string): Promise<void>
  runAgentReview(url: string): Promise<void>
}

/** The workspace name Start review gives, for example `review-api-7`. */
export function reviewWorkspaceName(rr: ReviewRequestView): string {
  return `review-${rr.projectPath.split('/').at(-1)}-${rr.iid}`
}

export function createReviewActions(deps: ReviewActionsDeps): ReviewActions {
  function reviewRequestOf(url: string): ReviewRequestView {
    const rr = deps.reviewRequest(url)
    if (!rr) throw new Error('This Review Request is no longer listed. Refresh and try again.')
    return rr
  }

  function listed(state: WorkspaceState) {
    if (state.kind === 'unavailable') throw new Error(`Workspaces are unavailable: ${state.reason}`)
    if (state.kind === 'unknown') throw new Error('Workspaces are not listed yet.')
    return state.index
  }

  /** The Review Workspace from the last list, listing again if that one didn't have it. */
  async function existingWorkspace(rr: ReviewRequestView): Promise<Worktree> {
    const current = deps.workspaces.current()
    const known = current.kind === 'listed' ? findReviewWorkspace(current.index, rr) : null
    const found = known ?? findReviewWorkspace(listed(await deps.workspaces.refresh()), rr)
    if (!found) throw new Error('This Review Request has no Review Workspace.')
    return found
  }

  const hostWorkspaceId = (worktree: Worktree) =>
    hostWorkspaceIdOf(deps.host, { name: worktree.displayName, path: worktree.path })

  async function agentReview(worktree: Worktree, rr: ReviewRequestView): Promise<void> {
    const workspaceId = await hostWorkspaceId(worktree)
    const settings = await deps.settings()
    const prompt = reviewPromptFor(settings.reviewPrompt, rr)
    if (settings.reviewCommand.trim() !== '') {
      const command = reviewCommandFor(settings.reviewCommand.trim(), prompt, rr)
      await deps.host.call('terminal.create', { workspaceId, title: 'Agent Review', command })
    } else {
      await deps.host.call('agent.launch', { workspaceId, agent: settings.reviewAgent, prompt })
    }
  }

  /**
   * Creates the Review Workspace (#54): based on the freshly fetched target branch, so Orca's
   * `baseRef` is the target branch and Source Control's "Committed on Branch" lists the MR's
   * changes, then reset to the MR head. A workspace whose reset failed is removed again.
   */
  async function createReviewWorkspace(rr: ReviewRequestView, repoPath: string, repoId: string): Promise<Worktree> {
    if (!rr.targetBranch) throw new Error("This Review Request has no target branch yet. Refresh and try again.")
    const baseBranch = await deps.git.fetchBranch(repoPath, rr.targetBranch)
    const head = await deps.git.fetchMergeRequestHead(repoPath, rr.iid)
    const worktree = await deps.cli().createWorktree({
      name: reviewWorkspaceName(rr),
      repo: `id:${repoId}`,
      baseBranch,
      gitlabMr: rr.url,
      noParent: true
    })
    try {
      await deps.git.resetHard(worktree.path, head)
    } catch (error) {
      const reason = `Couldn't check out the merge request in the new Review Workspace ${worktree.displayName}: ${messageOf(error)}`
      try {
        await deps.cli().removeWorktree(`id:${worktree.id}`, { force: true, deleteBranch: true })
      } catch (removeError) {
        throw new Error(`${reason}. Removing it failed too (${messageOf(removeError)}); remove it in Orca before you start the review again.`)
      } finally {
        await deps.workspaces.refresh()
      }
      throw new Error(`${reason}. The workspace was removed; start the review again.`)
    }
    await deps.workspaces.refresh()
    return worktree
  }

  return {
    async startReview(url, withAgent) {
      const rr = reviewRequestOf(url)
      const index = listed(await deps.workspaces.refresh())
      let worktree = findReviewWorkspace(index, rr)
      if (!worktree) {
        const repo = findRepo(index, rr)
        if (!repo) throw new Error(`Add ${rr.projectPath} to Orca to review here.`)
        worktree = await createReviewWorkspace(rr, repo.path, repo.repoId)
      }
      if (!withAgent) return
      try {
        await agentReview(worktree, rr)
      } catch (error) {
        throw new Error(`The Review Workspace is ready, but the Agent Review didn't start: ${messageOf(error)}`)
      }
    },
    async openWorkspace(url) {
      const worktree = await existingWorkspace(reviewRequestOf(url))
      await deps.host.call('workspace.open', { workspaceId: await hostWorkspaceId(worktree) })
    },
    async runAgentReview(url) {
      const rr = reviewRequestOf(url)
      await agentReview(await existingWorkspace(rr), rr)
    }
  }
}

/** The host's id (`workspace.list`) for a workspace the orca CLI lists, matched by path. */
export async function hostWorkspaceIdOf(
  host: OrcaWorkerApi['host'],
  workspace: { name: string; path: string }
): Promise<string> {
  const { workspaces } = await host.call('workspace.list')
  const row = workspaces.find((w) => w.path === workspace.path)
  if (!row) throw new Error(`Orca doesn't list the workspace ${workspace.name}.`)
  return row.id
}
