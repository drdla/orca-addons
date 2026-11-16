// Which Orca workspace is a Review Request's Review Workspace, and which Orca repo can host one,
// from one `orca worktree list --json` per poll (#7). A Review Workspace is ANY workspace linked to
// the MR: by its web URL in `linkedItems[]`, or by the legacy `linkedGitLabMR` number in a
// workspace of the MR's own project. There is no fallback to branch names.
//
// Filters (#26) ask hasReviewWorkspace(): a filtered-out Review Request with a workspace stays.
import type { Worktree } from '../seams/orca-cli'

/** What the lookups need to know about a Review Request. */
export type MergeRequestRef = { url: string; projectPath: string; iid: number }

/** One `orca worktree list` answer, indexed for the lookups below. */
export type WorkspaceIndex = {
  worktrees: Worktree[]
  /** Normalized MR URL → the first workspace linked to it. */
  byUrl: Map<string, Worktree>
}

export function workspaceIndexOf(worktrees: Worktree[]): WorkspaceIndex {
  const byUrl = new Map<string, Worktree>()
  for (const worktree of worktrees) {
    for (const item of worktree.linkedItems) {
      if (item.provider !== 'gitlab' || item.type !== 'mr') continue
      const key = normalizeMergeRequestUrl(item.url)
      if (key !== null && !byUrl.has(key)) byUrl.set(key, worktree)
    }
  }
  return { worktrees, byUrl }
}

export function findReviewWorkspace(index: WorkspaceIndex, mr: MergeRequestRef): Worktree | null {
  const key = normalizeMergeRequestUrl(mr.url)
  const linked = key === null ? undefined : index.byUrl.get(key)
  if (linked) return linked
  const projectId = projectIdOf(mr)
  return (
    index.worktrees.find(
      (w) => w.linkedGitLabMR === mr.iid && projectId !== null && sameText(w.projectId, projectId)
    ) ?? null
  )
}

/** The predicate the filters use (#26): does this Review Request have a Review Workspace? */
export function hasReviewWorkspace(index: WorkspaceIndex, mr: MergeRequestRef): boolean {
  return findReviewWorkspace(index, mr) !== null
}

/** The main worktree of the Orca repo cloned from the MR's project, or null if Orca has none. */
export function findRepo(index: WorkspaceIndex, mr: MergeRequestRef): Worktree | null {
  const projectId = projectIdOf(mr)
  if (projectId === null) return null
  return index.worktrees.find((w) => w.isMainWorktree && sameText(w.projectId, projectId)) ?? null
}

/** `https://host/group/project/-/merge_requests/7`, lower-cased host, nothing after the iid. */
export function normalizeMergeRequestUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const match = /^(.*?\/-\/merge_requests\/\d+)(?:\/.*)?$/.exec(parsed.pathname)
  if (!match) return null
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${match[1]!.toLowerCase()}`
}

/** Orca's project id for the MR's project: `git:<host>/<project path>`. */
function projectIdOf(mr: MergeRequestRef): string | null {
  try {
    return `git:${new URL(mr.url).host}/${mr.projectPath}`
  } catch {
    return null
  }
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
