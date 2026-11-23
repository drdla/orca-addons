// Removing a Review Workspace, always with its branch: Orca's `worktree rm --delete-branch` only
// deletes a branch that was merged, and a review branch never is, so each removal left one behind
// (and the next Review Workspace of that MR got a `-2` name). After Orca removed the worktree, the
// plugin deletes the branch itself (`git branch -D` in the repo's main worktree). The workspace
// is gone by then, so a failed branch delete is logged, not thrown.
import type { Worktree } from '../seams/orca-cli'
import type { WorkspaceContext } from './workspace-context'

type Context = Pick<WorkspaceContext, 'cli' | 'git' | 'workspaces' | 'log'>

/** The workspace to remove; its branch and repo are looked up in the workspace list when not given. */
export type RemovedWorkspace = { id: string; branch?: string | null; repoPath?: string }

export async function removeReviewWorkspace(
  context: Context,
  workspace: RemovedWorkspace,
  options: { force?: boolean } = {}
): Promise<void> {
  const { branch, repoPath } = branchOf(context, workspace)
  await context.cli().removeWorktree(`id:${workspace.id}`, { deleteBranch: true, ...(options.force ? { force: true } : {}) })
  if (branch === null || repoPath === null) {
    context.log(`removed ${workspace.id}; its branch is unknown, so it was not deleted`)
    return
  }
  try {
    await context.git.deleteBranch(repoPath, branch)
  } catch (error) {
    context.log(`removed ${workspace.id}, but deleting its branch ${branch} failed: ${String(error)}`)
  }
}

function branchOf(context: Context, workspace: RemovedWorkspace): { branch: string | null; repoPath: string | null } {
  const state = context.workspaces.current()
  const worktrees: Worktree[] = state.kind === 'listed' ? state.index.worktrees : []
  const listed = worktrees.find((w) => w.id === workspace.id)
  const repoId = listed?.repoId ?? workspace.id.split('::')[0]
  const main = worktrees.find((w) => w.isMainWorktree && w.repoId === repoId)
  const branch = workspace.branch !== undefined ? workspace.branch : (listed?.branch ?? null)
  return { branch: branch === null ? null : shortBranch(branch), repoPath: workspace.repoPath ?? main?.path ?? null }
}

/** `refs/heads/review-api-7` → `review-api-7`. */
function shortBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, '')
}
