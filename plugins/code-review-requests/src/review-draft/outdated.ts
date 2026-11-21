// Outdated Review Comments and stale Agent Findings (#58). A Review Comment records the commit it
// was written against (`sha`). Once the Review Workspace's HEAD is another commit (Update workspace
// moved it, or anything outside the plugin did), git tells which lines changed between the two:
//   - a comment whose lines a change touched, or whose file was deleted (or is binary and changed),
//     may be outdated. An insertion between two lines of a range touches it; one before its first
//     or after its last line doesn't. A file comment (no line) is touched by any change to its file.
//   - an Agent Finding whose commit isn't HEAD is stale, whatever changed.
// A rename alone changes no line. General comments are never outdated.
//
// It is recomputed against HEAD every time the Review Draft is imported (opened, Import again,
// right after Update workspace), never per poll: one `git diff` per distinct older commit.
import { messageOf } from '../errors'
import type { FileChange, Git } from '../seams/git'
import { isPosted, type ReviewComment } from './review-drafts'

/** What the last import found, against the workspace HEAD it read. */
export type Staleness = {
  /** The Review Workspace's HEAD when it was computed. */
  head: string
  /** Ids of the Review Comments that may be outdated. */
  outdated: string[]
}

/** Computes the Staleness of `comments` at `head`, and a warning when git couldn't tell. */
export async function stalenessOf(
  git: Git,
  worktreePath: string,
  head: string,
  comments: ReviewComment[]
): Promise<{ staleness: Staleness; warnings: string[] }> {
  const outdated: string[] = []
  const warnings: string[] = []
  const bySha = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    // Posted ones are done: GitLab tracks them now.
    if (comment.sha === null || comment.sha === head || comment.filePath === null || isPosted(comment)) continue
    bySha.set(comment.sha, [...(bySha.get(comment.sha) ?? []), comment])
  }
  for (const [sha, written] of bySha) {
    let changes: FileChange[]
    try {
      changes = await git.fileChanges(worktreePath, sha, head)
    } catch (error) {
      const n = written.length
      warnings.push(
        `Couldn't tell whether ${n === 1 ? '1 Review Comment' : `${n} Review Comments`} written on ` +
          `${sha.slice(0, 8)} may be outdated: ${messageOf(error)}`
      )
      continue
    }
    for (const comment of written) if (isTouched(comment, changes)) outdated.push(comment.id)
  }
  return { staleness: { head, outdated }, warnings }
}

function isTouched(comment: ReviewComment, changes: FileChange[]): boolean {
  const change = changes.find((c) => c.oldPath === comment.filePath)
  if (change === undefined) return false
  if (change.newPath === null || change.hunks === 'all') return true
  if (comment.line === null) return change.hunks.length > 0
  const first = comment.startLine ?? comment.line
  const last = comment.line
  return change.hunks.some(({ start, count }) =>
    count === 0 ? first <= start && start < last : start <= last && first <= start + count - 1
  )
}

/** Is this comment an Agent Finding reported for another commit than `head`? */
export function isStale(comment: ReviewComment, staleness: Staleness | undefined): boolean {
  return (
    staleness !== undefined && comment.origin === 'agent-finding' && comment.sha !== null && comment.sha !== staleness.head
  )
}
