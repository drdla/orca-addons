// Importing into a Review Draft (#29) and curating it. An import reads the Review Workspace's
// diff-view notes (`orca worktree show --json` → diffComments, read-only, #12) and the Agent
// Review's findings.json, and merges them into the stored draft:
//   - Diff-view notes follow Orca: an edited note takes the new text (and the current HEAD as its
//     commit), a deleted one leaves the draft, a new one joins checked. Markdown-preview notes are
//     not diff comments and are left out; notes on uncommitted changes are skipped with a warning.
//   - Agent Findings are the plugin's own once imported: they join unchecked, keep the person's
//     edits, and are never removed by an import. A finding already imported (same text) isn't added again.
// A failure to read either source keeps what the draft had and becomes a warning.
import type { ReviewCommentView, ReviewDraftView, ReviewWorkspaceView } from '../protocol'
import type { Clock } from '../seams/clock'
import type { Files } from '../seams/files'
import type { Git } from '../seams/git'
import type { DiffComment, OrcaCli } from '../seams/orca-cli'
import { FINDINGS_FILE, parseFindings, type AgentFinding } from './findings'
import { isPosted, type ReviewComment, type ReviewDraft, type ReviewDrafts } from './review-drafts'

/** The Review Request a draft belongs to, with its Review Workspace if it has one. */
export type DraftTarget = {
  url: string
  title: string
  workspace: ReviewWorkspaceView | null
  /** Why there is no workspace to read, when it isn't simply "none" (the orca CLI is broken). */
  workspaceProblem?: string | null
}

export type CommentChange = { id: string; checked?: boolean; body?: string }

/** A refused change: the panel shows the message on the comment. */
export class DraftChangeError extends Error {
  readonly code = 'invalid_params'
}

export function createDraftImport(options: {
  drafts: ReviewDrafts
  cli: () => OrcaCli
  git: Git
  files: Files
  clock: Pick<Clock, 'now'>
}) {
  const { drafts, git, files, clock } = options

  /** Reads both sources; null for a source that couldn't be read. */
  async function readSources(workspace: ReviewWorkspaceView) {
    const warnings: string[] = []
    const headSha = await git.headSha(workspace.path).catch((error: unknown) => {
      warnings.push(`Couldn't read the workspace's commit: ${messageOf(error)}`)
      return null
    })
    const notes = await options
      .cli()
      .showWorktree(`id:${workspace.id}`)
      .then((detail) => detail.diffComments ?? [])
      .catch((error: unknown) => {
        warnings.push(`Couldn't read the diff-view notes: ${messageOf(error)}`)
        return null
      })
    const findingsText = await files.readText(`${workspace.path}/${FINDINGS_FILE}`).catch((error: unknown) => {
      warnings.push(`Couldn't read ${FINDINGS_FILE}: ${messageOf(error)}`)
      return null
    })
    const parsed = findingsText === null ? null : parseFindings(findingsText)
    if (parsed) warnings.push(...parsed.warnings)
    return { headSha, notes, findings: parsed?.findings ?? [], findingsSha: parsed?.headSha ?? null, warnings }
  }

  return {
    /** Imports into the draft (when there is a workspace) and answers it. */
    async open(target: DraftTarget): Promise<ReviewDraftView> {
      const now = clock.now()
      if (target.workspace === null) {
        const warning =
          target.workspaceProblem ?? 'This Review Request has no Review Workspace, so there is nothing to import.'
        const draft = await drafts.update(target.url, (d) => ({ ...d, warnings: [warning] }))
        return viewOf(draft, target)
      }
      const sources = await readSources(target.workspace)
      const draft = await drafts.update(target.url, (d) => merge(d, sources, now))
      return viewOf(draft, target)
    },

    /** Checks or unchecks a comment, or edits an Agent Finding; answers the draft. */
    async change(target: DraftTarget, change: CommentChange): Promise<ReviewDraftView> {
      const now = clock.now()
      const draft = await drafts.update(target.url, (d) => {
        const comment = d.comments.find((c) => c.id === change.id)
        if (!comment) throw new DraftChangeError('That Review Comment is no longer in the Review Draft.')
        if (isPosted(comment)) throw new DraftChangeError('That Review Comment is already posted to GitLab.')
        let next = comment
        if (change.body !== undefined) {
          if (comment.origin === 'diff-note') {
            throw new DraftChangeError('This is a diff-view note: edit it in Orca, then open the Review Draft again.')
          }
          const body = change.body.trim()
          if (body === '') throw new DraftChangeError('A Review Comment needs some text.')
          if (body !== comment.body) next = { ...next, body, updatedAt: now }
        }
        if (change.checked !== undefined) next = { ...next, checked: change.checked }
        return { ...d, comments: d.comments.map((c) => (c.id === comment.id ? next : c)) }
      })
      return viewOf(draft, target)
    }
  }
}

type Sources = {
  headSha: string | null
  notes: DiffComment[] | null
  findings: AgentFinding[]
  findingsSha: string | null
  warnings: string[]
}

function merge(draft: ReviewDraft, sources: Sources, now: number): ReviewDraft {
  const previous = new Map(draft.comments.map((c) => [c.id, c]))
  const warnings = [...sources.warnings]

  let notes: ReviewComment[]
  if (sources.notes === null) {
    notes = draft.comments.filter((c) => c.origin === 'diff-note')
  } else {
    const diffNotes = sources.notes.filter((n) => n.source !== 'markdown')
    const uncommitted = diffNotes.filter((n) => n.scope === 'unstaged' || n.scope === 'staged')
    if (uncommitted.length > 0) {
      const what = uncommitted.length === 1 ? '1 diff-view note' : `${uncommitted.length} diff-view notes`
      warnings.push(`${what} on uncommitted changes skipped: GitLab only has committed code.`)
    }
    notes = diffNotes
      .filter((n) => !uncommitted.includes(n))
      .map((n) => fromNote(n, previous.get(`note:${n.id}`), sources.headSha))
  }

  const findings = draft.comments.filter((c) => c.origin === 'agent-finding')
  const known = new Set(findings.map((c) => c.id))
  for (const finding of sources.findings) {
    const id = findingId(finding)
    if (known.has(id)) continue
    known.add(id)
    findings.push({
      id,
      origin: 'agent-finding',
      filePath: finding.filePath,
      line: finding.line,
      ...(finding.startLine === undefined ? {} : { startLine: finding.startLine }),
      body: finding.body,
      checked: false,
      sha: sources.findingsSha ?? sources.headSha,
      updatedAt: now,
      posted: null
    })
  }
  return { ...draft, comments: [...notes, ...findings], warnings, importedAt: now }
}

function fromNote(note: DiffComment, before: ReviewComment | undefined, headSha: string | null): ReviewComment {
  const updatedAt = note.updatedAt ?? note.createdAt
  if (before && before.updatedAt === updatedAt) return before
  const startLine = note.startLine !== undefined && note.startLine < note.lineNumber ? note.startLine : undefined
  return {
    id: `note:${note.id}`,
    origin: 'diff-note',
    filePath: note.filePath,
    ...(note.oldPath ? { oldPath: note.oldPath } : {}),
    line: note.lineNumber,
    ...(startLine === undefined ? {} : { startLine }),
    body: note.body,
    checked: before?.checked ?? true,
    sha: headSha,
    updatedAt,
    posted: before?.posted ?? null
  }
}

/** A finding's identity: what the Agent Review wrote, so a re-import doesn't add it twice. */
function findingId(finding: AgentFinding): string {
  const text = JSON.stringify([finding.filePath, finding.startLine ?? null, finding.line, finding.body])
  // FNV-1a, 32 bit: short and stable; a collision only hides a duplicate-looking finding.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `finding:${hash.toString(16).padStart(8, '0')}`
}

export function viewOf(draft: ReviewDraft, target: DraftTarget): ReviewDraftView {
  return {
    url: target.url,
    title: target.title,
    workspace: target.workspace,
    comments: draft.comments.map(commentView),
    warnings: draft.warnings,
    importedAt: draft.importedAt
  }
}

function commentView(comment: ReviewComment): ReviewCommentView {
  const posted = isPosted(comment)
  return {
    id: comment.id,
    origin: comment.origin,
    filePath: comment.filePath,
    line: comment.line,
    ...(comment.startLine === undefined ? {} : { startLine: comment.startLine }),
    body: comment.body,
    checked: comment.checked,
    editable: comment.origin === 'agent-finding' && !posted,
    sha: comment.sha,
    posted
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
