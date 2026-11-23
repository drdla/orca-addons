// What the panel's workspace buttons do (#6, #27): Start review (create the Review Workspace
// through the orca CLI, linked to the MR, optionally followed by an Agent Review), Open workspace
// and Run Agent Review. Start review and Open workspace also build and open the Review Cover Page
// (#55, src/cover-page); an Agent Review reads that page, so it is built before the agent (#56).
// Update workspace (#57) moves a Review Workspace to the merge request's new head. Every failure
// rejects with a message the panel shows on the card.
import { coverPageTargetOf, type CoverPages } from '../cover-page/cover-pages'
import type { ReviewRequestView } from '../protocol'
import { mergeRequestHeadRef, targetBranchFullRef } from '../seams/git'
import type { Worktree } from '../seams/orca-cli'
import type { Settings } from '../settings'
import { reviewCommandFor, reviewPromptFor } from './review-prompt'
import { hostWorkspaceIdOf } from './host-workspace'
import { REVIEW_FOLDER } from './review-folder'
import { findRepo, findReviewWorkspace, normalizeMergeRequestUrl } from './review-workspaces'
import type { WorkspaceContext } from './workspace-context'
import type { WorkspaceHeads } from './workspace-heads'
import type { WorkspaceState } from './workspace-tracker'
import { messageOf } from '../errors'

export type ReviewActionsDeps = WorkspaceContext & {
  settings: () => Promise<Settings>
  /** The listed Review Request with this URL, if any. */
  reviewRequest: (url: string) => ReviewRequestView | undefined
  /** The Review Cover Page (#55), built and opened after the workspace exists. */
  coverPages: CoverPages
  /** Which Review Workspaces are behind their merge request (#57); Update workspace records its HEAD. */
  heads: WorkspaceHeads
  /**
   * Update workspace moved the workspace's HEAD (#58): called as soon as it did, before the steps
   * that may still fail (finishing the reset, the Review Cover Page). Must not reject.
   */
  onMoved?: (update: WorkspaceUpdate) => Promise<void>
}

/**
 * What Update workspace did (#57): the Review Workspace moved from `from` to `to`. For #58 it only
 * hands over `from`: which Review Comments may be outdated is worked out by comparing each one's
 * `sha` with the workspace's current HEAD at every Review Draft import, so it survives a worker
 * restart and an update made outside the plugin.
 */
export type WorkspaceUpdate = { url: string; worktreePath: string; from: string; to: string }

export type ReviewActions = {
  /** Creates (or reuses) the Review Workspace, then starts an Agent Review if `withAgent`. */
  startReview(url: string, withAgent: boolean): Promise<void>
  openWorkspace(url: string): Promise<void>
  runAgentReview(url: string): Promise<void>
  /** Opens the Review Cover Page, building it first if the workspace has none (#55). */
  openCoverPage(url: string): Promise<void>
  /** Shows the Review Workspace and toggles Orca's Source Control sidebar (its changed files). */
  showChanges(url: string): Promise<void>
  /** Opens a file of the Review Workspace at `line` (or its top) and switches Orca to it. */
  openFile(url: string, path: string, line: number | null): Promise<void>
  /**
   * Moves a clean Review Workspace to the merge request's current head and rebuilds its Review
   * Cover Page (#57). Rejects, changing nothing, when it has uncommitted changes.
   */
  updateWorkspace(url: string): Promise<WorkspaceUpdate>
}

/**
 * The name Start review creates the workspace with, for example `review-api-7`: Orca makes the
 * branch and folder from it.
 */
export function reviewWorkspaceName(rr: ReviewRequestView): string {
  return `review-${rr.projectPath.split('/').at(-1)}-${rr.iid}`
}

/** The name Orca then shows for a Review Workspace: `REVIEW <MR title>`. */
export function reviewDisplayName(rr: ReviewRequestView): string {
  return `REVIEW ${rr.title.trim()}`
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

  /**
   * Starts an Agent Review. It diffs against `{baseRef}`, the target branch, so without one it
   * refuses (the diff would be empty). `fetchBase` first refreshes that branch, for a workspace
   * made earlier (#56): a failed fetch is fine while the ref is there, a missing ref is not.
   */
  async function agentReview(
    worktree: Worktree,
    rr: ReviewRequestView,
    fetchBase: boolean,
    focus: boolean
  ): Promise<void> {
    const targetBranch = rr.targetBranch
    if (!targetBranch) throw new Error('This Review Request has no target branch yet. Refresh and try again.')
    if (fetchBase) {
      await deps.git.fetchBranch(worktree.path, targetBranch).catch(async (error: unknown) => {
        if ((await deps.git.resolveRef(worktree.path, targetBranchFullRef(targetBranch))) === null) throw error
      })
    }
    const settings = await deps.settings()
    const prompt = reviewPromptFor(settings.reviewPrompt, rr)
    if (settings.reviewCommand.trim() !== '') {
      const command = reviewCommandFor(settings.reviewCommand.trim(), prompt, rr)
      await deps.host.call('terminal.create', { workspaceId: await hostWorkspaceId(worktree), title: 'Agent Review', command })
    } else {
      // Through the orca CLI, not the host API's `agent.launch`: that one started the agent but
      // never sent it the prompt (see OrcaCli.launchAgent).
      await deps.cli().launchAgent({ worktree: `id:${worktree.id}`, agent: settings.reviewAgent, prompt, focus })
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
    // Only the shown name: the workspace works without it, so a failure here is not the review's.
    let shown = worktree
    try {
      await deps.cli().setDisplayName(`id:${worktree.id}`, reviewDisplayName(rr))
      shown = { ...worktree, displayName: reviewDisplayName(rr) }
    } catch {}
    await deps.workspaces.refresh()
    return shown
  }

  /**
   * An existing Review Workspace whose branch is still at the target branch (a create whose reset
   * never ran) is moved to the MR head, but only when it has no uncommitted changes; an Agent
   * Review there would see an empty diff. A workspace with commits of its own is left alone.
   */
  async function ensureAtMergeRequest(worktree: Worktree, rr: ReviewRequestView): Promise<void> {
    if (!rr.targetBranch) return
    const target = await deps.git.resolveRef(worktree.path, targetBranchFullRef(rr.targetBranch))
    if (target === null || (await deps.git.headSha(worktree.path)) !== target) return
    if ((await deps.git.statusPorcelain(worktree.path)).length > 0) {
      throw new Error(
        `The Review Workspace ${worktree.displayName} is still at the target branch ${rr.targetBranch} and has uncommitted changes, so it doesn't show the merge request. Remove it and start the review again.`
      )
    }
    await deps.git.resetBranch(worktree.path, await deps.git.fetchMergeRequestHead(worktree.path, rr.iid))
  }

  /**
   * Runs the Review Workspace setup command, if one is set, in a terminal of the workspace: the
   * plugin skips Orca's setup (see createReviewWorkspace), and nothing else installs a fresh
   * worktree's dependencies. It runs once the workspace shows the merge request.
   */
  async function runSetup(worktree: Worktree): Promise<void> {
    const command = (await deps.settings()).setupCommand.trim()
    if (command === '') return
    await deps.host.call('terminal.create', { workspaceId: await hostWorkspaceId(worktree), title: 'Setup', command })
  }

  /** Switches Orca to the workspace. */
  async function openIn(worktree: Worktree): Promise<void> {
    await deps.host.call('workspace.open', { workspaceId: await hostWorkspaceId(worktree) })
  }

  async function startReview(rr: ReviewRequestView, withAgent: boolean): Promise<void> {
    const index = listed(await deps.workspaces.refresh())
    let worktree = findReviewWorkspace(index, rr)
    const existed = worktree !== null
    if (worktree) {
      await ensureAtMergeRequest(worktree, rr)
    } else {
      const repo = findRepo(index, rr)
      if (!repo) throw new Error(`Add ${rr.projectPath} to Orca to review here.`)
      worktree = await createReviewWorkspace(rr, repo.path, repo.repoId)
    }
    // The workspace opens right away, so the reviewer lands in it while the page builds.
    const opened = await settle(openIn(worktree))
    // Only a workspace made here: an existing one was set up when it was made.
    const setup = existed ? null : await settle(runSetup(worktree))
    // The Review Cover Page (#55) is built first, because the Agent Review reads it (#56); a page
    // that fails doesn't hold the agent back. The page opens last: the tab in front.
    const target = coverPageTarget(worktree, rr)
    const page = await settle(deps.coverPages.ensure(target))
    // Not focused: the Review Cover Page opens in front afterwards.
    const agent = withAgent ? await settle(agentReview(worktree, rr, existed, false)) : null
    const problems: string[] = []
    if (opened !== null) problems.push(`it didn't open: ${messageOf(opened)}`)
    if (setup !== null) problems.push(`the setup command didn't start: ${messageOf(setup)}`)
    if (agent !== null) problems.push(`the Agent Review didn't start: ${messageOf(agent)}`)
    const shown = page ?? (await settle(deps.coverPages.reveal(target)))
    if (shown !== null) problems.push(`the Review Cover Page didn't open: ${messageOf(shown)}`)
    if (problems.length > 0) throw new Error(`The Review Workspace is ready, but ${problems.join('; ')}`)
  }

  /** Refuses, changing nothing, while the workspace has uncommitted changes a reset would lose. */
  async function refuseUncommitted(worktree: Worktree): Promise<void> {
    const changes = (await deps.git.statusPorcelain(worktree.path)).filter((entry) => !isOwnUntracked(entry))
    if (changes.length === 0) return
    const count = changes.length === 1 ? '1 uncommitted change' : `${changes.length} uncommitted changes`
    throw new Error(
      `The Review Workspace ${worktree.displayName} has ${count}: commit or stash them first. Nothing was changed.`
    )
  }

  /** Refuses unless `head` is (in) `mergeRequestHead`: the reviewer has no commits of their own. */
  async function refuseLocalCommits(worktree: Worktree, head: string, mergeRequestHead: string | null): Promise<void> {
    if (mergeRequestHead !== null && (await deps.git.isAncestor(worktree.path, head, mergeRequestHead))) return
    throw new Error(
      `The Review Workspace ${worktree.displayName} has local commits that aren't in the merge request; ` +
        'nothing was changed.'
    )
  }

  /**
   * Update workspace (#57): fetch the target branch and the MR head, and hard-reset the workspace's
   * branch to the head. Orca's `baseRef` (the remote-tracking target branch) is not changed, only
   * fetched fresh, so "Committed on Branch" shows the updated merge request. It refuses, changing
   * nothing, while a reset would lose uncommitted changes (checked again right before the reset)
   * or commits of the reviewer's own.
   */
  async function updateWorkspace(rr: ReviewRequestView): Promise<WorkspaceUpdate> {
    const targetBranch = rr.targetBranch
    if (!targetBranch) throw new Error('This Review Request has no target branch yet. Refresh and try again.')
    const worktree = await existingWorkspace(rr)
    const name = worktree.displayName
    await refuseUncommitted(worktree)
    const from = await deps.git.headSha(worktree.path)
    // Own commits: HEAD is not in the MR head fetched last time. Comparing with the new head would
    // refuse every force-push (a rebased merge request), so the check runs before fetching it.
    const fetchedBefore = await deps.git.resolveRef(worktree.path, mergeRequestHeadRef(rr.iid))
    if (fetchedBefore !== null) await refuseLocalCommits(worktree, from, fetchedBefore)
    // The base moves too: after a rebase onto a newer target, a stale remote-tracking target
    // branch would put the target's commits into "Committed on Branch" and the Agent Review's diff.
    try {
      await deps.git.fetchBranch(worktree.path, targetBranch)
    } catch (error) {
      throw new Error(
        `Couldn't fetch the target branch ${targetBranch}: ${sentence(error)}. The workspace wasn't changed.`
      )
    }
    let head: string
    try {
      head = await deps.git.fetchMergeRequestHead(worktree.path, rr.iid)
    } catch (error) {
      throw new Error(
        `Update workspace fetched the target branch ${targetBranch}, but fetching the merge request failed: ` +
          `${sentence(error)}. The workspace wasn't changed.`
      )
    }
    // Never fetched before: nothing to tell own commits by but the new head itself.
    if (fetchedBefore === null) await refuseLocalCommits(worktree, from, await deps.git.resolveRef(worktree.path, head))
    // Edits made while fetching would be lost too.
    await refuseUncommitted(worktree)
    let failure: unknown = null
    try {
      await deps.git.resetBranch(worktree.path, head)
    } catch (error) {
      failure = error
    }
    // Wherever the branch ended up, the card follows it, even when a later step of the reset failed.
    const to = await deps.git.headSha(worktree.path).catch(() => null)
    if (to !== null) deps.heads.record(worktree.path, to)
    if (to !== null && to !== from) await deps.onMoved?.({ url: rr.url, worktreePath: worktree.path, from, to })
    if (failure !== null) {
      if (to !== null && to !== from) {
        throw new Error(
          `The Review Workspace ${name} moved to the new head, but finishing the reset failed: ${sentence(failure)}.`
        )
      }
      throw new Error(
        `Resetting the Review Workspace ${name} failed: ${sentence(failure)}. The workspace wasn't changed.`
      )
    }
    const target = coverPageTarget(worktree, rr)
    try {
      await deps.coverPages.rebuild(target)
    } catch (error) {
      throw new Error(`The workspace is updated, but its Review Cover Page wasn't rebuilt: ${messageOf(error)}`)
    }
    // The rebuilt page in front: what changed.
    try {
      await deps.coverPages.reveal(target)
    } catch (error) {
      throw new Error(`The workspace is updated, but its Review Cover Page didn't open: ${messageOf(error)}`)
    }
    // The new head may change the dependencies.
    try {
      await runSetup(worktree)
    } catch (error) {
      throw new Error(`The workspace is updated, but the setup command didn't start: ${messageOf(error)}`)
    }
    return { url: rr.url, worktreePath: worktree.path, from, to: to ?? from }
  }

  /**
   * Workspace changes still running, by MR URL: Start review and Update workspace (#57). A second
   * click on the same action joins the first; the other action is refused until it is done.
   */
  const running = new Map<string, { action: WorkspaceChange; done: Promise<unknown> }>()

  function exclusive<T>(rr: ReviewRequestView, action: WorkspaceChange, change: () => Promise<T>): Promise<T> {
    const key = normalizeMergeRequestUrl(rr.url) ?? rr.url
    const current = running.get(key)
    if (current?.action === action) return current.done as Promise<T>
    if (current) {
      const message = `${current.action} is still running for this merge request. Try again when it's done.`
      return Promise.reject(new Error(message))
    }
    const done = change().finally(() => running.delete(key))
    running.set(key, { action, done })
    return done
  }

  const coverPageTarget = (worktree: Worktree, rr: ReviewRequestView) =>
    coverPageTargetOf(rr, { ...worktree, name: worktree.displayName })

  return {
    async startReview(url, withAgent) {
      const rr = reviewRequestOf(url)
      return exclusive(rr, 'Start Review', () => startReview(rr, withAgent))
    },
    async openWorkspace(url) {
      const rr = reviewRequestOf(url)
      const worktree = await existingWorkspace(rr)
      await openIn(worktree)
      // A Review Workspace from before #55 (or made by hand) gets its Review Cover Page now.
      await deps.coverPages.openIfMissing(coverPageTarget(worktree, rr))
    },
    async openCoverPage(url) {
      const rr = reviewRequestOf(url)
      const worktree = await existingWorkspace(rr)
      // The page opens in the workspace's editor: switch to it first, or it opens out of sight.
      await openIn(worktree)
      await deps.coverPages.open(coverPageTarget(worktree, rr))
    },
    async showChanges(url) {
      const rr = reviewRequestOf(url)
      const worktree = await existingWorkspace(rr)
      await openIn(worktree)
      await deps.host.call('commands.run', { action: 'sidebar.sourceControl.toggle' })
    },
    async openFile(url, path, line) {
      const worktree = await existingWorkspace(reviewRequestOf(url))
      await deps.cli().openFile({ worktree: `id:${worktree.id}`, path, ...(line === null ? {} : { line }) })
    },
    async runAgentReview(url) {
      const rr = reviewRequestOf(url)
      const worktree = await existingWorkspace(rr)
      // The agent runs in the workspace: switch to it, so the Agent Review is in view.
      await openIn(worktree)
      // The Agent Review reads the Review Cover Page (#56): a workspace without one gets it first.
      // Best effort: without the page, the Review Prompt sends the agent to GitLab for the description.
      await settle(deps.coverPages.ensure(coverPageTarget(worktree, rr)))
      // Focused: the reviewer clicked for the agent, so its terminal comes to the front.
      await agentReview(worktree, rr, true, true)
    },
    async updateWorkspace(url) {
      const rr = reviewRequestOf(url)
      return exclusive(rr, 'Update Workspace', () => updateWorkspace(rr))
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

/** The workspace changes that never run at once for one merge request. */
type WorkspaceChange = 'Start Review' | 'Update Workspace'

/**
 * An untracked entry of `git status --porcelain -z` in the plugin's own folder (when the exclude
 * file doesn't hide it yet): a reset leaves it alone. Every tracked change counts, renames too.
 */
function isOwnUntracked(entry: string): boolean {
  return entry.startsWith('?? ') && entry.slice(3).startsWith(`${REVIEW_FOLDER}/`)
}

/** An error's message without its trailing period, to go on inside a sentence. */
function sentence(error: unknown): string {
  return messageOf(error).trim().replace(/\.+$/, '')
}
