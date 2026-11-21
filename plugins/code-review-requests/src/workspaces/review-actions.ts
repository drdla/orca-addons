// What the panel's workspace buttons do (#6, #27): Start review (create the Review Workspace
// through the orca CLI, linked to the MR, optionally followed by an Agent Review), Open workspace
// and Run Agent Review. Start review and Open workspace also build and open the Review Cover Page
// (#55, src/cover-page). Every failure rejects with a message the panel shows on the card.
import { coverPageTargetOf, type CoverPages } from '../cover-page/cover-pages'
import type { ReviewRequestView } from '../protocol'
import type { Worktree } from '../seams/orca-cli'
import type { Settings } from '../settings'
import { reviewCommandFor, reviewPromptFor } from './review-prompt'
import { hostWorkspaceIdOf } from './host-workspace'
import { findRepo, findReviewWorkspace } from './review-workspaces'
import type { WorkspaceContext } from './workspace-context'
import type { WorkspaceState } from './workspace-tracker'
import { messageOf } from '../errors'

export type ReviewActionsDeps = WorkspaceContext & {
  settings: () => Promise<Settings>
  /** The listed Review Request with this URL, if any. */
  reviewRequest: (url: string) => ReviewRequestView | undefined
  /** The Review Cover Page (#55), built and opened after the workspace exists. */
  coverPages: CoverPages
}

export type ReviewActions = {
  /** Creates (or reuses) the Review Workspace, then starts an Agent Review if `withAgent`. */
  startReview(url: string, withAgent: boolean): Promise<void>
  openWorkspace(url: string): Promise<void>
  runAgentReview(url: string): Promise<void>
  /** Opens the Review Cover Page, building it first if the workspace has none (#55). */
  openCoverPage(url: string): Promise<void>
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

  const coverPageTarget = (worktree: Worktree, rr: ReviewRequestView) =>
    coverPageTargetOf(rr, { ...worktree, name: worktree.displayName })

  return {
    async startReview(url, withAgent) {
      const rr = reviewRequestOf(url)
      const index = listed(await deps.workspaces.refresh())
      let worktree = findReviewWorkspace(index, rr)
      if (!worktree) {
        const repo = findRepo(index, rr)
        if (!repo) throw new Error(`Add ${rr.projectPath} to Orca to review here.`)
        const baseBranch = await deps.git.fetchMergeRequestHead(repo.path, rr.iid)
        worktree = await deps.cli().createWorktree({
          name: reviewWorkspaceName(rr),
          repo: `id:${repo.repoId}`,
          baseBranch,
          gitlabMr: rr.url,
          noParent: true
        })
        await deps.workspaces.refresh()
      }
      // The Review Cover Page (#55) builds while the agent starts, and opens last: the tab in front.
      const target = coverPageTarget(worktree, rr)
      const [page, agent] = await Promise.allSettled([
        deps.coverPages.ensure(target),
        withAgent ? agentReview(worktree, rr) : Promise.resolve()
      ])
      const problems: string[] = []
      if (agent.status === 'rejected') problems.push(`the Agent Review didn't start: ${messageOf(agent.reason)}`)
      const shown = page.status === 'rejected' ? page.reason : await deps.coverPages.reveal(target).then(() => null, (e: unknown) => e)
      if (shown !== null) problems.push(`the Review Cover Page didn't open: ${messageOf(shown)}`)
      if (problems.length > 0) throw new Error(`The Review Workspace is ready, but ${problems.join('; ')}`)
    },
    async openWorkspace(url) {
      const rr = reviewRequestOf(url)
      const worktree = await existingWorkspace(rr)
      await deps.host.call('workspace.open', { workspaceId: await hostWorkspaceId(worktree) })
      // A Review Workspace from before #55 (or made by hand) gets its Review Cover Page now.
      await deps.coverPages.openIfMissing(coverPageTarget(worktree, rr))
    },
    async openCoverPage(url) {
      const rr = reviewRequestOf(url)
      await deps.coverPages.open(coverPageTarget(await existingWorkspace(rr), rr))
    },
    async runAgentReview(url) {
      const rr = reviewRequestOf(url)
      await agentReview(await existingWorkspace(rr), rr)
    }
  }
}
