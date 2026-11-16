// The live smoke script's `--post` run (#31): one Review Draft, posted to the one MR the user
// named, through the plugin's own poster (review-draft/post-review.ts), so the line position,
// bulk_publish (or the `/submit_review` note before GitLab 19.2), re-listing and approve are the
// real code paths. It writes two Review Comments, a line one (on the first added line of the
// diff, or --file/--line) and a general one, plus a summary, then reads the MR's notes back and
// reports their URLs. Before any write it prints the plan and asks; it refuses when the user's
// own drafts are pending on the MR, because bulk_publish would publish those too.
import { messageOf } from '../errors'
import { createReviewPoster, locationOf } from '../review-draft/post-review'
import { createReviewDrafts, type DraftStorage, type ReviewComment } from '../review-draft/review-drafts'
import type { GitLabTransport } from '../seams/gitlab'
import type { Check, CheckStatus } from './read-only-checks'
import type { SmokeTarget } from './smoke-args'

export type PostSmokeOptions = {
  transport: GitLabTransport
  target: SmokeTarget
  approve: boolean
  /** Where the line comment goes; null takes the first added line of the MR's diff. */
  line: { path: string; line: number } | null
  /** Unique per run; every body written carries it, so the notes can be found again. */
  tag: string
  now: () => number
  /** Shown the plan; resolves true to go ahead. */
  confirm(plan: string): Promise<boolean>
}

export type PostSmokeResult = { outcome: 'posted' | 'cancelled'; checks: Check[] }

type MergeRequest = { title: string; state: string; diff_refs: { head_sha: string } | null }
type Diff = { old_path: string; new_path: string; diff: string; deleted_file?: boolean }
type AddedLine = { path: string; oldPath?: string; line: number }
type Note = { id: number; body: string; type?: string | null; position?: { new_path?: string; new_line?: number } | null }

export async function runPostSmoke(options: PostSmokeOptions): Promise<PostSmokeResult> {
  const { transport, target, tag } = options
  const base = `/projects/${encodeURIComponent(target.projectPath)}/merge_requests/${target.iid}`

  const mr = await transport.rest<MergeRequest>('GET', base)
  if (mr.state !== 'opened') throw new Error(`${target.url} is ${mr.state}: post to an open MR`)
  const head = mr.diff_refs?.head_sha ?? null
  if (head === null) throw new Error(`${target.url} has no diff yet`)
  const where: AddedLine | null = options.line ?? firstAddedLine(await transport.rest<Diff[]>('GET', `${base}/diffs`))
  if (where === null) {
    throw new Error(`No added line in the first page of ${target.url}'s diff: pass --file <path> --line <n>`)
  }

  const marker = (kind: string) => `[${tag} ${kind}]`
  const comments: ReviewComment[] = [
    comment('smoke:line', {
      filePath: where.path,
      ...(where.oldPath === undefined ? {} : { oldPath: where.oldPath }),
      line: where.line,
      body: `${marker('line')} Line comment from the code-review-requests live smoke test. Safe to delete.`
    }),
    comment('smoke:general', {
      filePath: null,
      line: null,
      body: `${marker('general')} General comment from the code-review-requests live smoke test. Safe to delete.`
    })
  ]
  function comment(id: string, fields: Pick<ReviewComment, 'filePath' | 'line' | 'body'> & { oldPath?: string }): ReviewComment {
    return { id, origin: 'diff-note', checked: true, sha: head, updatedAt: options.now(), posted: null, ...fields }
  }
  const summary = `${marker('summary')} Review posted by the code-review-requests live smoke test. Safe to ignore.`

  const drafts = createReviewDrafts(memoryStorage(), { now: options.now })
  await drafts.update(target.url, (d) => ({ ...d, comments }))
  const poster = createReviewPoster({
    drafts,
    connection: async () => ({ transport, token: null }),
    notify: async () => undefined
  })

  const preview = await poster.preview(target)
  if (preview.leftoverDrafts.length > 0) {
    const n = preview.leftoverDrafts.length
    throw new Error(
      `You have ${n} pending draft${n === 1 ? '' : 's'} on ${target.url}; posting would publish ${n === 1 ? 'it' : 'them'} too. ` +
        'Publish or delete them in GitLab first.'
    )
  }

  const plan = [
    'About to write to GitLab:',
    `  MR:        ${target.url} ("${mr.title}")`,
    `  Comments:  ${preview.comments}, published as one review`,
    ...comments.map((c) => `    - ${locationOf(c)}: ${c.body}`),
    `  Summary:   ${summary}`,
    `  Outcome:   comment (reviewer state "reviewed")`,
    `  Approve:   ${options.approve ? `yes, at ${head.slice(0, 12)}` : 'no'}`,
    ...preview.warnings.map((w) => `  Warning:   ${w}`)
  ].join('\n')
  if (!(await options.confirm(plan))) return { outcome: 'cancelled', checks: [] }

  const result = await poster.post(target, { summary, outcome: options.approve ? 'approve' : 'comment' })
  const posted = (await drafts.get(target.url))?.comments.flatMap((c) => (c.posted ? [c.posted.noteId] : [])) ?? []

  const checks: Check[] = []
  const add = (name: string, status: CheckStatus, detail: string) => checks.push({ name, status, detail })
  add(
    'Drafts published',
    result.posted === comments.length && result.failed.length === 0 ? 'pass' : 'fail',
    [
      `${result.posted} of ${comments.length} published (draft note ids ${posted.join(', ') || 'none'})`,
      ...result.failed.map((f) => `${f.location}: ${f.message}`)
    ].join('; ')
  )

  const notes = await transport.rest<Note[]>('GET', `${base}/notes`).catch((error: unknown) => {
    add('Notes read back', 'fail', messageOf(error))
    return [] as Note[]
  })
  const noteOf = (kind: string) => notes.find((n) => n.body.includes(marker(kind)))
  const link = (n: Note) => `${target.url}#note_${n.id}`

  const line = noteOf('line')
  if (line === undefined) add('Line comment', 'fail', 'not among the MR notes')
  else if (line.position?.new_line === undefined) {
    add('Line comment', 'fail', `${link(line)}: published as a general note, GitLab did not take the line position`)
  } else {
    add('Line comment', 'pass', `${link(line)} (diff note on ${line.position.new_path}:${line.position.new_line})`)
  }
  const general = noteOf('general')
  add('General comment', general ? 'pass' : 'fail', general ? link(general) : 'not among the MR notes')
  const summaryNote = noteOf('summary')
  add('Summary', summaryNote ? 'pass' : 'warn', summaryNote ? link(summaryNote) : 'no note carries the summary')

  const left = (await transport.rest<{ id: number; note: string }[]>('GET', `${base}/draft_notes`)).filter((d) =>
    d.note.includes(`[${tag} `)
  )
  add('No drafts left', left.length === 0 ? 'pass' : 'fail', left.length === 0 ? 'none pending' : `still drafts: ${left.map((d) => d.id).join(', ')}`)

  if (options.approve) {
    add('Approved', result.approveError === null ? 'pass' : 'fail', result.approveError ?? `at ${head.slice(0, 12)}`)
  }
  return { outcome: 'posted', checks }
}

/**
 * The first added line in a list of MR diffs (`GET …/diffs`), as a new-file line number, skipping
 * deleted files. Hunks are `@@ -a,b +c,d @@`; context and added lines count on the new side.
 */
export function firstAddedLine(diffs: Diff[]): AddedLine | null {
  for (const file of diffs) {
    if (file.deleted_file) continue
    let next: number | null = null
    for (const text of file.diff.split('\n')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
      if (hunk) next = Number(hunk[1])
      else if (next === null || text.startsWith('-') || text.startsWith('\\')) continue
      else if (text.startsWith('+')) {
        return { path: file.new_path, ...(file.old_path === file.new_path ? {} : { oldPath: file.old_path }), line: next }
      } else next++
    }
  }
  return null
}

/** The Review Draft lives only for this run; nothing is stored. */
function memoryStorage(): DraftStorage {
  const map = new Map<string, unknown>()
  return {
    get: async (key: string) => (map.get(key) ?? null) as never,
    set: async (key: string, value: unknown) => {
      map.set(key, value)
    },
    delete: async (key: string) => {
      map.delete(key)
    },
    keys: async () => [...map.keys()]
  } as DraftStorage
}
