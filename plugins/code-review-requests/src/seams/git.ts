// The Git seam: what the plugin does with `git` itself, in a repo or workspace on this machine.
// Orca's own "Start workspace from MR" fetches the MR head into a private ref no plugin can reach
// (research #3), so Start review fetches it here (#27). #28 adds the uncommitted-changes check.
// Real: src/git-process.ts. Fake: src/fakes/fake-git.ts.

export interface Git {
  /**
   * Fetches the MR's head (`refs/merge-requests/<iid>/head`, which GitLab keeps on the target
   * project, also for MRs from forks) from `origin` in the repo at `repoPath`, and returns a ref
   * to start a workspace from.
   */
  fetchMergeRequestHead(repoPath: string, iid: number): Promise<string>
  /**
   * `git status --porcelain` in the workspace at `path`: one line per uncommitted change
   * (untracked files included), empty when clean (#28; no Orca API exposes it).
   */
  statusPorcelain(path: string): Promise<string[]>
}
