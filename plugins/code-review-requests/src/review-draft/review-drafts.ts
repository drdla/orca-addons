// The Review Draft store (#29): one Review Draft per Review Request, kept in plugin storage under
// `reviewDraft:<MR url>`, so it outlives worker restarts and is readable by every feature:
//   - the drill-in panel view curates it (worker.ts `rr.draft` / `rr.updateDraftComment`),
//   - posting (#30) reads `toPost(url)` and records `markPosted(url, marks)`,
//   - workspace removal (#28) and posting ask `hasUnposted(url)`.
//   - each poll tick, `sweep` deletes the drafts whose Review Workspace is gone, however it went
//     (removed in Orca or by the CLI, or ended while workspaces couldn't be listed).
//
// "Posted" is tracked here, by comment id plus the `updatedAt` it had when posted (#12): Orca's
// diff-view notes can't be written, and an edit in Orca after posting changes `updatedAt`, which
// makes the note unposted again.
import type { OrcaWorkerApi } from 'orca/worker'
import type { Clock } from '../seams/clock'
import type { Outdated } from './outdated'

/** What posting recorded for a Review Comment. */
export type PostedMark = {
  /** The GitLab note id the comment became (#30). */
  noteId: number
  /** The comment's `updatedAt` when it was posted. */
  updatedAt: number
  /** When it was posted (ms). */
  postedAt: number
}

/** One Review Comment as stored. */
export type ReviewComment = {
  /** `note:<Orca note id>` or `finding:<hash of what the Agent Review wrote>`. */
  id: string
  origin: 'diff-note' | 'agent-finding'
  /** Relative to the workspace; null for a general comment. */
  filePath: string | null
  /** The note's old path, for a renamed file. */
  oldPath?: string
  /** The new-file line, or null for a general comment. */
  line: number | null
  /** The first line of a range (inclusive), if it is one. */
  startLine?: number
  body: string
  checked: boolean
  /** Marked blocking in the Review Draft, or by the Agent Review. Absent means not. */
  blocking?: true
  /** The commit the comment was made against (the workspace HEAD at import, or findings.json's headSha). */
  sha: string | null
  /** A diff-view note's `updatedAt ?? createdAt`; for an Agent Finding, when it was imported or edited. */
  updatedAt: number
  /** Set by posting; only counts while `updatedAt` still matches (see isPosted). */
  posted: PostedMark | null
}

export type ReviewDraft = {
  url: string
  /** Diff-view notes first, then Agent Findings. */
  comments: ReviewComment[]
  /** What the last import skipped or couldn't read. */
  warnings: string[]
  importedAt: number | null
  /**
   * Drafts the last post (#30) left on GitLab because they didn't publish. A later post deletes
   * and re-creates them (retry); Delete failed drafts removes them. Absent means none.
   */
  failedDrafts?: FailedDraft[]
  /**
   * Which Review Comments may be outdated, as the last import worked out against the Review
   * Workspace's HEAD (#58). Absent when HEAD couldn't be read (or before #58).
   */
  outdated?: Outdated
  /**
   * Ids of Agent Findings the reviewer deleted: an import doesn't bring them back while
   * findings.json still has them. Absent means none.
   */
  deletedFindings?: string[]
  /**
   * Diff-view notes posting dismissed because they weren't checked (#81), by id, with the
   * `updatedAt` they had then. An import leaves one out until it is edited in Orca; then it comes
   * back unchecked. Absent means none.
   */
  dismissedNotes?: Record<string, number>
}

/** A Review Comment whose GitLab draft didn't publish. */
export type FailedDraft = { commentId: string; draftNoteId: number; message: string }

/** The part of orca.storage the store uses. */
export type DraftStorage = Pick<OrcaWorkerApi['storage'], 'get' | 'set' | 'delete' | 'keys'>

const KEY_PREFIX = 'reviewDraft:'
/** `draftWrittenAt:<MR url>`: the commit Update workspace moved away from, until the next import (#58). */
const WRITTEN_AT_PREFIX = 'draftWrittenAt:'

export function draftKey(url: string): string {
  return `${KEY_PREFIX}${url}`
}

export function emptyDraft(url: string): ReviewDraft {
  return { url, comments: [], warnings: [], importedAt: null }
}

/** Posted, and not changed since. */
export function isPosted(comment: ReviewComment): boolean {
  return comment.posted !== null && comment.posted.updatedAt === comment.updatedAt
}

/** Checked and not posted: what "Post to GitLab" would send. */
export function isUnposted(comment: ReviewComment): boolean {
  return comment.checked && !isPosted(comment)
}

/** A posted comment, as posting (#30) reports it. */
export type PostedComment = { commentId: string; noteId: number; updatedAt: number }

export type ReviewDrafts = ReturnType<typeof createReviewDrafts>

// Updates of one draft run one after another, also across store instances of this worker.
const queues = new Map<string, Promise<unknown>>()

export function createReviewDrafts(storage: DraftStorage, clock: Pick<Clock, 'now'>) {
  async function get(url: string): Promise<ReviewDraft | null> {
    const stored = (await storage.get(draftKey(url))) as ReviewDraft | null
    return stored ?? null
  }

  /** Read-modify-write of one draft (created empty if missing), serialized per URL. */
  function update(url: string, change: (draft: ReviewDraft) => ReviewDraft): Promise<ReviewDraft> {
    const run = (queues.get(url) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const next = change((await get(url)) ?? emptyDraft(url))
      await storage.set(draftKey(url), next as unknown as Parameters<DraftStorage['set']>[1])
      return next
    })
    queues.set(url, run)
    return run
  }

  return {
    get,
    update,
    /** The checked Review Comments not yet posted, in draft order. */
    async toPost(url: string): Promise<ReviewComment[]> {
      return ((await get(url))?.comments ?? []).filter(isUnposted)
    },
    /** Does this Review Request have checked Review Comments that aren't posted? (#28, #30) */
    async hasUnposted(url: string): Promise<boolean> {
      return ((await get(url))?.comments ?? []).some(isUnposted)
    },
    /** Records what posting created. A mark for a comment that changed since stays unposted. */
    markPosted(url: string, marks: PostedComment[]): Promise<ReviewDraft> {
      const postedAt = clock.now()
      return update(url, (draft) => ({
        ...draft,
        comments: draft.comments.map((comment) => {
          const mark = marks.find((m) => m.commentId === comment.id)
          return mark ? { ...comment, posted: { noteId: mark.noteId, updatedAt: mark.updatedAt, postedAt } } : comment
        })
      }))
    },
    /**
     * After a review was posted (#81): drops what wasn't checked for it, so the next round starts
     * clean. Unchecked Agent Findings are deleted (imports skip them from then on); unchecked
     * diff-view notes are dismissed (they stay in Orca's diff view, which the plugin can't write).
     * Posted comments stay, as the record of what was said.
     */
    clearUnchecked(url: string): Promise<ReviewDraft> {
      return update(url, (draft) => {
        const dropped = draft.comments.filter((c) => !c.checked && !isPosted(c))
        if (dropped.length === 0) return draft
        const findings = dropped.filter((c) => c.origin === 'agent-finding').map((c) => c.id)
        const notes = dropped.filter((c) => c.origin === 'diff-note')
        const deleted = draft.deletedFindings ?? []
        return {
          ...draft,
          comments: draft.comments.filter((c) => !dropped.includes(c)),
          ...(findings.length === 0 ? {} : { deletedFindings: [...deleted, ...findings.filter((id) => !deleted.includes(id))] }),
          ...(notes.length === 0
            ? {}
            : { dismissedNotes: { ...draft.dismissedNotes, ...Object.fromEntries(notes.map((c) => [c.id, c.updatedAt])) } })
        }
      })
    },
    /**
     * Update workspace moved the Review Workspace away from commit `sha` (#58): what the next
     * import adds was written against it. An earlier one not yet applied is kept, being older.
     */
    async noteWrittenAt(url: string, sha: string): Promise<void> {
      if (((await storage.get(`${WRITTEN_AT_PREFIX}${url}`)) ?? null) === null) {
        await storage.set(`${WRITTEN_AT_PREFIX}${url}`, sha)
      }
    },
    /** The commit noteWrittenAt recorded and no import has applied yet, or null. */
    async writtenAt(url: string): Promise<string | null> {
      const sha = await storage.get(`${WRITTEN_AT_PREFIX}${url}`)
      return typeof sha === 'string' ? sha : null
    },
    /** An import applied it. */
    async clearWrittenAt(url: string): Promise<void> {
      await storage.delete(`${WRITTEN_AT_PREFIX}${url}`)
    },
    /** Forgets a Review Request's draft (for example once its workspace is removed). */
    async remove(url: string): Promise<void> {
      await storage.delete(draftKey(url))
      await storage.delete(`${WRITTEN_AT_PREFIX}${url}`)
    },
    /**
     * Deletes the drafts no Review Workspace belongs to any more; answers their URLs. Only with a
     * complete workspace list: `hasWorkspace` must know every workspace. A draft whose URL isn't
     * a merge request URL is kept. Whether the MR is listed doesn't matter: one made draft keeps
     * its workspace, and its Review Draft with it.
     */
    async sweep(hasWorkspace: (url: string) => boolean | null): Promise<string[]> {
      const gone: string[] = []
      for (const url of await this.urls()) {
        if (hasWorkspace(url) !== false) continue
        await this.remove(url)
        gone.push(url)
      }
      return gone
    },
    /** The MR URLs that have a Review Draft. */
    async urls(): Promise<string[]> {
      return (await storage.keys()).filter((k) => k.startsWith(KEY_PREFIX)).map((k) => k.slice(KEY_PREFIX.length))
    }
  }
}
