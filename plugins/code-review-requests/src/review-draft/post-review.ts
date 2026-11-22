// Posting a Review Draft to GitLab (#13, #14, #30), through REST draft notes:
//   1. Read the MR (current `diff_refs`), its diff versions, my pending drafts and GitLab's version.
//   2. Create one draft per checked, unposted Review Comment: a line comment against the MR version
//      whose head is the comment's commit, or, when no version matches (or it has no line), a
//      general comment that starts with `path:line`. A comment that may be outdated (#58) posts
//      the same way: its line exists in the version it was written on (also when a later version
//      changed or deleted it), so GitLab shows it there, marked outdated, with the code it meant.
//      Moving it to the latest version would put it on whatever line now has that number.
//   3. Publish them as one review: `bulk_publish` with the summary and reviewer state on GitLab
//      19.2+, a `/submit_review <state>` note on 17.4–19.1. Approve also calls `POST /approve` with
//      the current head SHA.
//   4. List the drafts again: ours still there didn't publish (GitLab keeps them). A line comment
//      that failed is retried once as a general `path:line` comment; what still fails stays in
//      the Review Draft, recorded with its GitLab draft so the next post replaces it (retry), or
//      Delete failed drafts removes it. That is the only time the plugin deletes a GitLab draft.
// Drafts I started elsewhere (the web UI) publish too; the confirm step lists them first.
import type { PostPreview, PostResult, ReviewOutcome } from '../protocol'
import { GitLabError, type GitLabAccess, type GitLabTransport, type Json } from '../seams/gitlab'
import { redactError } from '../gitlab/http-response'
import type { FailedDraft, PostedComment, ReviewComment, ReviewDraft, ReviewDrafts } from './review-drafts'
import { messageOf } from '../errors'
import { plural } from '../plural'
import { isOutdated } from './outdated'

/** Which MR to post to. */
export type PostTarget = { url: string; projectPath: string; iid: number; /** For the notification. */ title?: string }

export const API_SCOPE_HINT = 'Posting a review needs a token with the api scope.'

type Version = { head_commit_sha: string; base_commit_sha: string; start_commit_sha: string }
type MergeRequest = { diff_refs: { base_sha: string; start_sha: string; head_sha: string } | null }
type Place = { new_path?: string; new_line?: number | null }
type DraftNote = { id: number; note: string; position?: Place | null }
type Note = { body: string; author: { username: string }; position?: Place | null }

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
  /** The last import found it may be outdated (#58). */
  outdated: boolean
}

export function createReviewPoster(options: {
  drafts: ReviewDrafts
  connection: () => Promise<GitLabAccess>
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
    const latestHead = mr.diff_refs?.head_sha ?? null
    const plan = (await drafts.toPost(target.url)).map((c) => ({
      ...planComment(c, versions, latestHead),
      outdated: isOutdated(c, draft?.outdated)
    }))
    return {
      base,
      mr,
      plan,
      /** My pending drafts that aren't ones this plugin left behind. */
      leftovers: pending.filter((d) => !ours.has(d.id)),
      /** Drafts the last post left that are still pending (they are replaced). */
      replaced: failed.filter((f) => pending.some((d) => d.id === f.draftNoteId))
    }
  }

  return {
    async preview(target: PostTarget): Promise<PostPreview> {
      const { transport, token } = await options.connection()
      try {
        const { plan, leftovers, replaced } = await read(target, transport)
        return {
          url: target.url,
          comments: plan.length,
          leftoverDrafts: leftovers.map((d) => ({ id: d.id, body: d.note })),
          warnings: warningsOf(plan, replaced.length)
        }
      } catch (error) {
        throw postingError(error, token)
      }
    },

    async post(target: PostTarget, request: { summary: string; outcome: ReviewOutcome }): Promise<Omit<PostResult, 'draft'>> {
      const { transport, token } = await options.connection()
      const summary = request.summary.trim()
      try {
        const { base, mr, plan, leftovers, replaced } = await read(target, transport)
        if (plan.length === 0 && leftovers.length === 0 && summary === '' && request.outcome === 'comment') {
          throw new Error('Nothing to post: check a Review Comment, write a summary or pick another outcome.')
        }
        const takesSummary = atLeast((await transport.rest<{ version: string }>('GET', '/version')).version, 19, 2)

        // Retry: the drafts the last post left behind are replaced by fresh ones.
        for (const f of replaced) await transport.rest('DELETE', `${base}/draft_notes/${f.draftNoteId}`)

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
          try {
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
          } catch (error) {
            if (error instanceof GitLabError && error.status === 403) throw error
            const ours = [
              ...created.map((c) => ({ id: c.draftId, note: c.planned.body, position: c.planned.position as Place | null })),
              ...leftovers
            ]
            await settleFailedPublish(transport, base, ours, new Set(created.map((c) => c.draftId)), summary, state, error)
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
          await options.notify(...postedNote(target, posted.length, request.outcome)).catch(() => {})
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

/**
 * After the publish call failed: gitlab.com 19.7 answered 500 after it had turned the drafts
 * into notes, but left them as drafts too and never applied the summary or reviewer state. A retry
 * would then post every comment twice. So read what GitLab actually did:
 *   - nothing published: delete the drafts this post created (the Review Comments stay unposted)
 *     and report the error;
 *   - some published: delete their leftover drafts, then post the summary (unless it's there) and
 *     Request changes as a note. The caller goes on as after a publish: what's still a draft is
 *     retried or recorded as failed.
 * A draft counts as published when one of my recent notes has its text on the same line.
 */
async function settleFailedPublish(
  transport: GitLabTransport,
  base: string,
  drafts: DraftNote[],
  createdIds: Set<number>,
  summary: string,
  state: string,
  error: unknown
): Promise<void> {
  const [me, notes, pending] = await Promise.all([
    transport.rest<{ username: string }>('GET', '/user'),
    transport.rest<Note[]>('GET', `${base}/notes?sort=desc&order_by=created_at&per_page=100`),
    transport.rest<DraftNote[]>('GET', `${base}/draft_notes`)
  ])
  const mine = notes.filter((n) => n.author.username === me.username)
  const stillPending = new Set(pending.map((d) => d.id))
  const published = drafts.filter((d) => mine.some((n) => n.body === d.note && samePlace(n.position, d.position)))
  if (published.length === 0) {
    for (const d of drafts) {
      if (createdIds.has(d.id) && stillPending.has(d.id)) await transport.rest('DELETE', `${base}/draft_notes/${d.id}`)
    }
    throw error
  }
  for (const d of published) {
    if (stillPending.has(d.id)) await transport.rest('DELETE', `${base}/draft_notes/${d.id}`)
  }
  const summaryThere = summary === '' || mine.some((n) => n.body === summary && !n.position)
  const body = [summaryThere ? '' : summary, state === 'requested_changes' ? '/request_changes' : '']
    .filter((s) => s !== '')
    .join('\n\n')
  if (body !== '') await transport.rest('POST', `${base}/notes`, { body })
}

function samePlace(a: Place | null | undefined, b: Place | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.new_path === b.new_path && a.new_line === b.new_line
}

function mrPath(target: PostTarget): string {
  return `/projects/${encodeURIComponent(target.projectPath)}/merge_requests/${target.iid}`
}

function planComment(comment: ReviewComment, versions: Version[], latestHead: string | null): Omit<Planned, 'outdated'> {
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

function warningsOf(plan: Planned[], replaced: number): string[] {
  const warnings: string[] = []
  const older = plan.filter((p) => p.older).length
  const unplaced = plan.filter((p) => p.unplaced).length
  // Only those that post on their version: the unplaced warning covers the rest.
  const outdated = plan.filter((p) => p.outdated && p.position !== null).length
  if (older > 0) {
    warnings.push(
      `The MR has new commits since ${plural(older, 'Review Comment')} ${older === 1 ? 'was' : 'were'} written: ` +
        `GitLab may show ${older === 1 ? 'it' : 'them'} as outdated.`
    )
  }
  if (outdated > 0) {
    warnings.push(
      `${plural(outdated, 'Review Comment')} may be outdated: ${outdated === 1 ? 'its' : 'their'} lines changed since. ` +
        `${outdated === 1 ? 'It posts' : 'They post'} on the version ${outdated === 1 ? 'it was' : 'they were'} written on.`
    )
  }
  if (unplaced > 0) {
    warnings.push(
      `${plural(unplaced, 'Review Comment')} ${unplaced === 1 ? 'was' : 'were'} written against a commit that is no MR version: ` +
        `${unplaced === 1 ? 'it posts' : 'they post'} as general comments starting with path:line.`
    )
  }
  if (replaced > 0) {
    warnings.push(`${plural(replaced, 'draft')} the last post left on GitLab will be replaced.`)
  }
  return warnings
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

function atLeast(version: string, major: number, minor: number): boolean {
  const [a = 0, b = 0] = version.split('.').map((n) => Number.parseInt(n, 10))
  return a > major || (a === major && b >= minor)
}

/** "You reviewed Add login" / "2 comments, approved · acme/api !7". */
export function postedNote(target: PostTarget, comments: number, outcome: ReviewOutcome): [string, string] {
  const parts: string[] = []
  if (comments > 0) parts.push(`${comments} ${comments === 1 ? 'comment' : 'comments'}`)
  if (outcome === 'approve') parts.push('approved')
  if (outcome === 'requested_changes') parts.push('changes requested')
  const where = `${target.projectPath} !${target.iid}`
  return [`You reviewed ${target.title ?? `!${target.iid}`}`, parts.length === 0 ? where : `${parts.join(', ')} · ${where}`]
}
