// Posting a Review Draft to GitLab (#13, #14, #30), through REST draft notes:
//   1. Read the MR (current `diff_refs`), its diff versions, my pending drafts and GitLab's version.
//   2. Create one draft per checked, unposted Review Comment: a line comment against the MR version
//      whose head is the comment's commit, or, when no version matches (or it has no line), a
//      general comment that starts with `path:line`.
//   3. Publish them as one review: `bulk_publish` with the summary and reviewer state on GitLab
//      19.2+, a `/submit_review <state>` note on 17.4–19.1. Approve also calls `POST /approve` with
//      the current head SHA.
//   4. List the drafts again: ours still there didn't publish (GitLab keeps them). A line comment
//      that failed is retried once as a general `path:line` comment; what still fails stays in
//      the Review Draft, recorded with its GitLab draft so the next post replaces it (retry), or
//      Delete failed drafts removes it. That is the only time the plugin deletes a GitLab draft.
// Drafts I started elsewhere (the web UI) publish too; the confirm step lists them first.
import type { PostPreview, PostResult, ReviewOutcome } from '../protocol'
import { GitLabError, type GitLabTransport, type Json } from '../seams/gitlab'
import { redactError } from '../gitlab/http-response'
import type { FailedDraft, PostedComment, ReviewComment, ReviewDraft, ReviewDrafts } from './review-drafts'

/** Which MR to post to. */
export type PostTarget = { url: string; projectPath: string; iid: number }

/** The transport for the configured connection, and its token (to redact), or null for glab. */
export type PostConnection = { transport: GitLabTransport; token: string | null }

export const API_SCOPE_HINT = 'Posting a review needs a token with the api scope.'

type Version = { head_commit_sha: string; base_commit_sha: string; start_commit_sha: string }
type MergeRequest = { diff_refs: { base_sha: string; start_sha: string; head_sha: string } | null }
type DraftNote = { id: number; note: string }

/** One Review Comment as it posts. */
type Planned = {
  comment: ReviewComment
  body: string
  /** The diff position, or null for a general comment. */
  position: Json | null
  /** Written against an MR version that isn't the latest. */
  older: boolean
  /** Has a line, but no MR version matches its commit: posts as a general comment. */
  unplaced: boolean
}

export function createReviewPoster(options: {
  drafts: ReviewDrafts
  connection: () => Promise<PostConnection>
  notify: (title: string, body: string) => Promise<unknown>
}) {
  const { drafts } = options

  async function read(target: PostTarget, transport: GitLabTransport) {
    const base = mrPath(target)
    const [mr, versions, pending, draft] = await Promise.all([
      transport.rest<MergeRequest>('GET', base),
      transport.rest<Version[]>('GET', `${base}/versions`),
      transport.rest<DraftNote[]>('GET', `${base}/draft_notes`),
      drafts.get(target.url)
    ])
    const failed = draft?.failedDrafts ?? []
    const ours = new Set(failed.map((f) => f.draftNoteId))
    const plan = (await drafts.toPost(target.url)).map((c) => planComment(c, versions, mr.diff_refs?.head_sha ?? null))
    return {
      base,
      mr,
      plan,
      /** My pending drafts that aren't ones this plugin left behind. */
      leftovers: pending.filter((d) => !ours.has(d.id)),
      /** Drafts the last post left that are still pending (they are replaced). */
      stale: failed.filter((f) => pending.some((d) => d.id === f.draftNoteId))
    }
  }

  return {
    async preview(target: PostTarget): Promise<PostPreview> {
      const { transport, token } = await options.connection()
      try {
        const { plan, leftovers, stale } = await read(target, transport)
        return {
          url: target.url,
          comments: plan.length,
          leftoverDrafts: leftovers.map((d) => ({ id: d.id, body: d.note })),
          warnings: warningsOf(plan, stale.length)
        }
      } catch (error) {
        throw postingError(error, token)
      }
    },

    async post(target: PostTarget, request: { summary: string; outcome: ReviewOutcome }): Promise<Omit<PostResult, 'draft'>> {
      const { transport, token } = await options.connection()
      const summary = request.summary.trim()
      try {
        const { base, mr, plan, leftovers, stale } = await read(target, transport)
        if (plan.length === 0 && leftovers.length === 0 && summary === '' && request.outcome === 'comment') {
          throw new Error('Nothing to post: check a Review Comment, write a summary or pick another outcome.')
        }
        const takesSummary = atLeast((await transport.rest<{ version: string }>('GET', '/version')).version, 19, 2)

        // Retry: the drafts the last post left behind are replaced by fresh ones.
        for (const f of stale) await transport.rest('DELETE', `${base}/draft_notes/${f.draftNoteId}`)

        const created: { planned: Planned; draftId: number }[] = []
        const failures: FailedDraft[] = []
        for (const planned of plan) {
          try {
            const draft = await transport.rest<DraftNote>('POST', `${base}/draft_notes`, draftBody(planned))
            created.push({ planned, draftId: draft.id })
          } catch (error) {
            // A missing scope fails every draft the same way: stop before publishing anything.
            if (error instanceof GitLabError && error.status === 403) throw error
            failures.push({ commentId: planned.comment.id, draftNoteId: 0, message: messageOf(redactError(error, token)) })
          }
        }

        const state = request.outcome === 'requested_changes' ? 'requested_changes' : 'reviewed'
        if (created.length + leftovers.length > 0) {
          if (takesSummary) {
            await transport.rest('POST', `${base}/draft_notes/bulk_publish`, {
              ...(summary === '' ? {} : { note: summary }),
              reviewer_state: state
            })
          } else {
            await transport.rest('POST', `${base}/notes`, {
              body: `${summary === '' ? '' : `${summary}\n\n`}/submit_review ${state}`
            })
          }
        } else if (summary !== '' || request.outcome === 'requested_changes') {
          // Nothing to publish: the summary (and Request changes) as one note.
          const action = request.outcome === 'requested_changes' ? '/request_changes' : ''
          await transport.rest('POST', `${base}/notes`, { body: [summary, action].filter((s) => s !== '').join('\n\n') })
        }

        // Ours still pending didn't publish. A line comment gets one more try as a general one.
        let pendingIds = new Set((await transport.rest<DraftNote[]>('GET', `${base}/draft_notes`)).map((d) => d.id))
        const retried = created.filter((c) => pendingIds.has(c.draftId) && c.planned.position !== null)
        if (retried.length > 0) {
          for (const c of retried) {
            await transport.rest('DELETE', `${base}/draft_notes/${c.draftId}`)
            const general = { ...c.planned, position: null, body: withLocation(c.planned.comment) }
            c.draftId = (await transport.rest<DraftNote>('POST', `${base}/draft_notes`, draftBody(general))).id
          }
          await transport.rest('POST', `${base}/draft_notes/bulk_publish`)
          pendingIds = new Set((await transport.rest<DraftNote[]>('GET', `${base}/draft_notes`)).map((d) => d.id))
        }

        const posted: PostedComment[] = []
        for (const c of created) {
          if (pendingIds.has(c.draftId)) {
            failures.push({ commentId: c.planned.comment.id, draftNoteId: c.draftId, message: 'GitLab kept it as a draft: it did not publish.' })
          } else {
            posted.push({ commentId: c.planned.comment.id, noteId: c.draftId, updatedAt: c.planned.comment.updatedAt })
          }
        }

        let approveError: string | null = null
        if (request.outcome === 'approve') {
          const sha = mr.diff_refs?.head_sha
          await transport
            .rest('POST', `${base}/approve`, sha ? { sha } : {})
            .catch((error: unknown) => (approveError = messageOf(postingError(error, token))))
        }

        await drafts.markPosted(target.url, posted)
        await drafts.update(target.url, (d) => withFailures(d, failures))
        if (posted.length > 0 || summary !== '' || request.outcome !== 'comment') {
          const n = posted.length
          await options
            .notify('Review posted', `${n} ${n === 1 ? 'comment' : 'comments'} on !${target.iid}`)
            .catch(() => {})
        }
        const byId = new Map(plan.map((p) => [p.comment.id, p.comment]))
        return {
          posted: posted.length,
          failed: failures.map((f) => ({ commentId: f.commentId, location: locationOf(byId.get(f.commentId)!), message: f.message })),
          approveError
        }
      } catch (error) {
        throw postingError(error, token)
      }
    },

    /** Deletes the drafts the last post left on GitLab; the Review Comments stay. */
    async deleteFailedDrafts(target: PostTarget): Promise<void> {
      const { transport, token } = await options.connection()
      const base = mrPath(target)
      const failed = (await drafts.get(target.url))?.failedDrafts ?? []
      try {
        const pending = new Set((await transport.rest<DraftNote[]>('GET', `${base}/draft_notes`)).map((d) => d.id))
        for (const f of failed) {
          if (pending.has(f.draftNoteId)) await transport.rest('DELETE', `${base}/draft_notes/${f.draftNoteId}`)
        }
      } catch (error) {
        throw postingError(error, token)
      }
      await drafts.update(target.url, (d) => withFailures(d, []))
    }
  }
}

export type ReviewPoster = ReturnType<typeof createReviewPoster>

function mrPath(target: PostTarget): string {
  return `/projects/${encodeURIComponent(target.projectPath)}/merge_requests/${target.iid}`
}

function planComment(comment: ReviewComment, versions: Version[], latestHead: string | null): Planned {
  const version = comment.sha === null ? undefined : versions.find((v) => v.head_commit_sha === comment.sha)
  if (comment.filePath === null || comment.line === null || version === undefined) {
    const located = comment.filePath !== null
    return {
      comment,
      body: located ? withLocation(comment) : comment.body,
      position: null,
      older: false,
      unplaced: comment.filePath !== null && comment.line !== null
    }
  }
  return {
    comment,
    body: comment.body,
    // The top-level new_line is the range's end; a range's start isn't sent (needs line codes).
    position: {
      position_type: 'text',
      base_sha: version.base_commit_sha,
      start_sha: version.start_commit_sha,
      head_sha: version.head_commit_sha,
      old_path: comment.oldPath ?? comment.filePath,
      new_path: comment.filePath,
      new_line: comment.line
    },
    older: latestHead !== null && version.head_commit_sha !== latestHead,
    unplaced: false
  }
}

function draftBody(planned: Planned): Json {
  return planned.position === null ? { note: planned.body } : { note: planned.body, position: planned.position }
}

/** "`src/a.ts:8–10`", then the body: a general comment that still says where. */
function withLocation(comment: ReviewComment): string {
  return `\`${locationOf(comment)}\`\n\n${comment.body}`
}

export function locationOf(comment: Pick<ReviewComment, 'filePath' | 'line' | 'startLine'>): string {
  if (comment.filePath === null) return 'General comment'
  if (comment.line === null) return comment.filePath
  const lines = comment.startLine === undefined ? `${comment.line}` : `${comment.startLine}–${comment.line}`
  return `${comment.filePath}:${lines}`
}

function warningsOf(plan: Planned[], stale: number): string[] {
  const warnings: string[] = []
  const older = plan.filter((p) => p.older).length
  const unplaced = plan.filter((p) => p.unplaced).length
  if (older > 0) {
    warnings.push(`The MR has new commits since ${count(older)} were written: GitLab may show them as outdated.`)
  }
  if (unplaced > 0) {
    warnings.push(
      `${count(unplaced)} ${unplaced === 1 ? 'was' : 'were'} written against a commit that is no MR version: ` +
        `${unplaced === 1 ? 'it posts' : 'they post'} as general comments starting with path:line.`
    )
  }
  if (stale > 0) {
    warnings.push(`${stale === 1 ? '1 draft' : `${stale} drafts`} the last post left on GitLab will be replaced.`)
  }
  return warnings
}

function count(n: number): string {
  return n === 1 ? '1 Review Comment' : `${n} Review Comments`
}

function withFailures(draft: ReviewDraft, failures: FailedDraft[]): ReviewDraft {
  const { failedDrafts: _old, ...rest } = draft
  return failures.length === 0 ? rest : { ...rest, failedDrafts: failures }
}

function postingError(error: unknown, token: string | null): Error {
  const redacted = redactError(error, token)
  if (redacted instanceof GitLabError && redacted.status === 403) {
    return new Error(`${API_SCOPE_HINT} GitLab said: ${redacted.message}`)
  }
  return redacted instanceof Error ? redacted : new Error(String(redacted))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function atLeast(version: string, major: number, minor: number): boolean {
  const [a = 0, b = 0] = version.split('.').map((n) => Number.parseInt(n, 10))
  return a > major || (a === major && b >= minor)
}
