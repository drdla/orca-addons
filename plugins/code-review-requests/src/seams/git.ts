// The Git seam: what the plugin does with `git` itself, in a repo or workspace on this machine.
// Orca's own "Start workspace from MR" fetches the MR head into a private ref no plugin can reach
// (research #3), so Start review fetches it here (#27). #28 adds the uncommitted-changes check.
// #54: the Review Workspace is created from the freshly fetched target branch (so Orca's `baseRef`
// is the target branch and Source Control shows the MR's changes), then reset to the MR head.
// Real: src/git-process.ts. Fake: src/fakes/fake-git.ts.

/**
 * The remote-tracking name of a target branch, `origin/<branch>`: the Review Workspace's base
 * (#54) and the Review Prompt's `{baseRef}` (#56).
 */
export function targetBranchRef(branch: string): string {
  return `origin/${branch}`
}

/** The same ref in full, `refs/remotes/origin/<branch>`, which no local branch name can shadow. */
export function targetBranchFullRef(branch: string): string {
  return `refs/remotes/${targetBranchRef(branch)}`
}

/**
 * One file `git diff -M -U0 <from> <to>` lists. Its hunks name lines of the file at `from`: `count`
 * lines from `start` were replaced or deleted, or, for `count` 0, lines were inserted after line
 * `start`. `'all'` for a binary file, whose lines git doesn't tell.
 */
export type FileChange = {
  /** The path at `from`, or null for a file `to` added. */
  oldPath: string | null
  /** The path at `to`, or null for a file `to` deleted. */
  newPath: string | null
  hunks: { start: number; count: number }[] | 'all'
}

export interface Git {
  /**
   * Fetches the MR's head (`refs/merge-requests/<iid>/head`, which GitLab keeps on the target
   * project, also for MRs from forks) from `origin` in the repo at `repoPath` (or any of its
   * worktrees), and returns its full remote-tracking ref,
   * `refs/remotes/origin/merge-requests/<iid>`, which no local branch name can shadow.
   */
  fetchMergeRequestHead(repoPath: string, iid: number): Promise<string>
  /**
   * Fetches `branch` from `origin` into `refs/remotes/origin/<branch>` in the repo at `repoPath`,
   * and returns its remote-tracking name (`origin/<branch>`), to base a workspace on (#54).
   */
  fetchBranch(repoPath: string, branch: string): Promise<string>
  /**
   * Moves the branch of the worktree at `worktreePath` to `ref` (`git reset --hard`) and drops its
   * upstream, so a pull can't merge the target branch in and a push can't go to it (#54).
   */
  resetBranch(worktreePath: string, ref: string): Promise<void>
  /** The commit `ref` names, seen from `path` (`git rev-parse --verify`); null if it doesn't resolve. */
  resolveRef(path: string, ref: string): Promise<string | null>
  /**
   * `git status --porcelain` in the workspace at `path`: one line per uncommitted change
   * (untracked files included), empty when clean (#28; no Orca API exposes it).
   */
  statusPorcelain(path: string): Promise<string[]>
  /**
   * Is `ancestor` an ancestor of (or the same commit as) `descendant`, seen from `path`
   * (`git merge-base --is-ancestor`)? Update workspace (#57) asks it so it never drops the
   * reviewer's own commits.
   */
  isAncestor(path: string, ancestor: string, descendant: string): Promise<boolean>
  /** The commit checked out in the worktree at `worktreePath` (`git rev-parse HEAD`), for #29. */
  headSha(worktreePath: string): Promise<string>
  /**
   * What changed between commits `from` and `to`, seen from `path` (`git diff -M -U0`), one entry
   * per changed file in git's order. #58 asks it whether a Review Comment written at `from` sits on
   * lines `to` changed.
   */
  fileChanges(path: string, from: string, to: string): Promise<FileChange[]>
  /**
   * The absolute path of `name` in the worktree's git dir as git resolves it
   * (`git rev-parse --path-format=absolute --git-path <name>`). In a linked worktree, `info/exclude`
   * resolves to the shared one in the main repo's `.git`: git reads no per-worktree exclude file.
   */
  gitPath(worktreePath: string, name: string): Promise<string>
}

/** Where fetchMergeRequestHead puts MR `iid`'s head: a full ref no local branch name can shadow. */
export function mergeRequestHeadRef(iid: number): string {
  return `refs/remotes/origin/merge-requests/${iid}`
}
