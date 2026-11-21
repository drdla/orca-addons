// Outdated Review Comments and stale Agent Findings (#58). A Review Comment records the commit it
// was written against (`sha`). Once the Review Workspace's HEAD is another commit (Update workspace
// moved it, or anything outside the plugin did), git tells which lines changed between the two:
//   - a comment whose lines a change touched, or whose file was deleted (or is binary, or changed
//     type), may be outdated. An insertion between two lines of a range touches it; one before its
//     first or after its last line doesn't. A file comment (no line) is touched by any change to
//     its file. Only the comments' own files are diffed, so a file renamed away looks deleted.
//   - an Agent Finding whose commit isn't HEAD is stale, whatever changed.
// General comments and posted ones are never outdated.
//
// It is recomputed against HEAD every time the Review Draft is imported (opened, Import again),
// never per poll: one `git diff` per distinct older commit.
import { messageOf } from '../errors'
import { plural } from '../plural'
import type { FileChange, Git } from '../seams/git'
import { isPosted, type ReviewComment } from './review-drafts'

/** Which Review Comments may be outdated, against the workspace HEAD the last import read. */
export type Outdated = {
  /** The Review Workspace's HEAD when it was computed. */
  head: string
  /** Ids of the Review Comments that may be outdated. */
  commentIds: string[]
}

/** Works out which of `comments` may be outdated at `head`, and a warning when git couldn't tell. */
export async function outdatedOf(
  git: Git,
  worktreePath: string,
  head: string,
  comments: ReviewComment[]
): Promise<{ outdated: Outdated; warnings: string[] }> {
  const commentIds: string[] = []
  const warnings: string[] = []
  const bySha = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    if (comment.sha === null || comment.sha === head || comment.filePath === null || isPosted(comment)) continue
    bySha.set(comment.sha, [...(bySha.get(comment.sha) ?? []), comment])
  }
  for (const [sha, written] of bySha) {
    const paths = [...new Set(written.map((c) => c.filePath!))]
    let changes: FileChange[]
    try {
      changes = await git.fileChanges(worktreePath, sha, head, paths)
    } catch (error) {
      warnings.push(
        `Couldn't tell whether ${plural(written.length, 'Review Comment')} written on ${sha.slice(0, 8)} ` +
          `may be outdated: ${messageOf(error)}`
      )
      continue
    }
    for (const comment of written) if (isTouched(comment, changes)) commentIds.push(comment.id)
  }
  return { outdated: { head, commentIds }, warnings }
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

/** May this unposted Review Comment be outdated, as the last import worked out? */
export function isOutdated(comment: ReviewComment, outdated: Outdated | undefined): boolean {
  return !isPosted(comment) && outdated !== undefined && outdated.commentIds.includes(comment.id)
}

/** Is this unposted comment an Agent Finding reported for another commit than the workspace's HEAD? */
export function isStale(comment: ReviewComment, outdated: Outdated | undefined): boolean {
  return (
    !isPosted(comment) &&
    outdated !== undefined &&
    comment.origin === 'agent-finding' &&
    comment.sha !== null &&
    comment.sha !== outdated.head
  )
}
