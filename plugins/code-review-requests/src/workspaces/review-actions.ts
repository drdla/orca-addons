// What the panel's workspace buttons do (#6, #27): Start review (create the Review Workspace
// through the orca CLI, linked to the MR, optionally followed by an Agent Review), Open workspace
// and Run Agent Review. Start review and Open workspace also build and open the Review Cover Page
// (#55, src/cover-page); an Agent Review reads that page, so it is built before the agent (#56).
// Every failure rejects with a message the panel shows on the card.
import { coverPageTargetOf, type CoverPages } from '../cover-page/cover-pages'
import type { ReviewRequestView } from '../protocol'
import type { Worktree } from '../seams/orca-cli'
import type { Settings } from '../settings'
import { reviewCommandFor, reviewPromptFor } from './review-prompt'
import { hostWorkspaceIdOf } from './host-workspace'
import { findRepo, findReviewWorkspace, normalizeMergeRequestUrl } from './review-workspaces'
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

  /**
   * Creates the Review Workspace (#54): based on the freshly fetched target branch, so Orca's
   * `baseRef` is the target branch and Source Control's "Committed on Branch" lists the MR's
   * changes, then reset to the MR head. A workspace whose reset failed is removed again.
   *
   * Orca's setup (repo setup hooks) is skipped: it would run while the worktree is still at the
   * target branch and race the reset, and neither the orca CLI nor the host API can run it later.
   * The trade-off: a Review Workspace gets no setup-hook work (dependency installs and the like).
   */
  async function createReviewWorkspace(rr: ReviewRequestView, repoPath: string, repoId: string): Promise<Worktree> {
    if (!rr.targetBranch) throw new Error('This Review Request has no target branch yet. Refresh and try again.')
    const baseBranch = await deps.git.fetchBranch(repoPath, rr.targetBranch)
    const head = await deps.git.fetchMergeRequestHead(repoPath, rr.iid)
    const worktree = await deps.cli().createWorktree({
      name: reviewWorkspaceName(rr),
      repo: `id:${repoId}`,
      baseBranch,
      gitlabMr: rr.url,
      noParent: true,
      setup: 'skip'
    })
    try {
      await deps.git.resetBranch(worktree.path, head)
    } catch (error) {
      const reason = `Couldn't check out the merge request in the new Review Workspace ${worktree.displayName}: ${sentence(error)}`
      try {
        await deps.cli().removeWorktree(`id:${worktree.id}`, { force: true, deleteBranch: true })
      } catch (removeError) {
        throw new Error(
          `${reason}. Removing it failed too (${sentence(removeError)}); remove it in Orca before you start the review again.`
        )
      } finally {
        await deps.workspaces.refresh()
      }
      throw new Error(`${reason}. The workspace was removed; start the review again.`)
    }
    await deps.workspaces.refresh()
    return worktree
  }

  /**
   * An existing Review Workspace whose branch is still at the target branch (a create whose reset
   * never ran) is moved to the MR head, but only when it has no uncommitted changes; an Agent
   * Review there would see an empty diff. A workspace with commits of its own is left alone.
   */
  async function ensureAtMergeRequest(worktree: Worktree, rr: ReviewRequestView): Promise<void> {
    if (!rr.targetBranch) return
    const target = await deps.git.resolveRef(worktree.path, `refs/remotes/origin/${rr.targetBranch}`)
    if (target === null || (await deps.git.headSha(worktree.path)) !== target) return
    if ((await deps.git.statusPorcelain(worktree.path)).length > 0) {
      throw new Error(
        `The Review Workspace ${worktree.displayName} is still at the target branch ${rr.targetBranch} and has uncommitted changes, so it doesn't show the merge request. Remove it and start the review again.`
      )
    }
    await deps.git.resetBranch(worktree.path, await deps.git.fetchMergeRequestHead(worktree.path, rr.iid))
  }

  async function startReview(rr: ReviewRequestView, withAgent: boolean): Promise<void> {
    const index = listed(await deps.workspaces.refresh())
    let worktree = findReviewWorkspace(index, rr)
    if (worktree) {
      await ensureAtMergeRequest(worktree, rr)
    } else {
      const repo = findRepo(index, rr)
      if (!repo) throw new Error(`Add ${rr.projectPath} to Orca to review here.`)
      worktree = await createReviewWorkspace(rr, repo.path, repo.repoId)
    }
    // The Review Cover Page (#55) is built first, because the Agent Review reads it (#56); a page
    // that fails doesn't hold the agent back. The page opens last: the tab in front.
    const target = coverPageTarget(worktree, rr)
    const page = await settle(deps.coverPages.ensure(target))
    const agent = withAgent ? await settle(agentReview(worktree, rr)) : null
    const problems: string[] = []
    if (agent !== null) problems.push(`the Agent Review didn't start: ${messageOf(agent)}`)
    const shown = page ?? (await settle(deps.coverPages.reveal(target)))
    if (shown !== null) problems.push(`the Review Cover Page didn't open: ${messageOf(shown)}`)
    if (problems.length > 0) throw new Error(`The Review Workspace is ready, but ${problems.join('; ')}`)
  }

  /** Start reviews still running, by MR URL: a second click joins the first (one workspace). */
  const starting = new Map<string, Promise<void>>()

  const coverPageTarget = (worktree: Worktree, rr: ReviewRequestView) =>
    coverPageTargetOf(rr, { ...worktree, name: worktree.displayName })

  return {
    async startReview(url, withAgent) {
      const rr = reviewRequestOf(url)
      const key = normalizeMergeRequestUrl(rr.url) ?? rr.url
      const running = starting.get(key)
      if (running) return running
      const started = startReview(rr, withAgent).finally(() => starting.delete(key))
      starting.set(key, started)
      return started
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
      const worktree = await existingWorkspace(rr)
      // The Agent Review reads the Review Cover Page (#56): a workspace without one gets it first.
      // Best effort: without the page, the Review Prompt sends the agent to GitLab for the description.
      await settle(deps.coverPages.ensure(coverPageTarget(worktree, rr)))
      await agentReview(worktree, rr)
    }
  }
}

/** Waits for the work; its error, or null when it succeeded. */
function settle(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => null,
    (error: unknown) => error ?? new Error('Unknown error')
  )
}

/** An error's message without its trailing period, to go on inside a sentence. */
function sentence(error: unknown): string {
  return messageOf(error).trim().replace(/\.+$/, '')
}
