// Which Review Workspaces show an older version of their merge request (#57): the head commit
// each poll reads from GitLab (`diffRefs.headSha`) against the commit checked out in the
// workspace (`git rev-parse HEAD`).
//
// Reading HEAD is one git process per workspace, so it runs only where it can tell something new:
// for Review Requests that have a Review Workspace, and there only when the merge request's head
// moved since the last read, or the workspace was behind then (it may have been updated outside
// the plugin since). A workspace known to be at an unchanged head costs nothing per poll. The
// cache lives in memory: after a worker restart the first poll reads each Review Workspace once.
// Update workspace records the HEAD it leaves behind, so the card follows at once.
import { messageOf } from '../errors'
import type { ReviewRequestView } from '../protocol'
import type { Git } from '../seams/git'
import { findReviewWorkspace } from './review-workspaces'
import type { WorkspaceState } from './workspace-tracker'

export type WorkspaceHeads = {
  /** After a good poll: reads the HEAD of the Review Workspaces that may have fallen behind. */
  check(reviewRequests: ReviewRequestView[], state: WorkspaceState): Promise<void>
  /** Is the workspace at `worktreePath` behind the merge request's head `mergeRequestHead`? */
  isBehind(worktreePath: string, mergeRequestHead: string | null | undefined): boolean
  /** The workspace at `worktreePath` is now at `head` (after Update workspace, say). */
  record(worktreePath: string, head: string): void
}

export function createWorkspaceHeads(git: Git, log: (message: string) => void): WorkspaceHeads {
  /** By worktree path: its HEAD, and the merge request head it was read against. */
  const known = new Map<string, { head: string; readAgainst: string }>()

  return {
    async check(reviewRequests, state) {
      if (state.kind !== 'listed') return
      const present = new Set<string>()
      for (const rr of reviewRequests) {
        const worktree = findReviewWorkspace(state.index, rr)
        if (!worktree || !rr.headSha) continue
        present.add(worktree.path)
        const entry = known.get(worktree.path)
        if (entry && entry.readAgainst === rr.headSha && entry.head === rr.headSha) continue
        try {
          known.set(worktree.path, { head: await git.headSha(worktree.path), readAgainst: rr.headSha })
        } catch (error) {
          known.delete(worktree.path)
          log(`git rev-parse HEAD failed in ${worktree.path}: ${messageOf(error)}`)
        }
      }
      for (const path of known.keys()) if (!present.has(path)) known.delete(path)
    },
    isBehind(worktreePath, mergeRequestHead) {
      const entry = known.get(worktreePath)
      return entry !== undefined && !!mergeRequestHead && entry.head !== mergeRequestHead
    },
    record(worktreePath, head) {
      known.set(worktreePath, { head, readAgainst: head })
    }
  }
}
