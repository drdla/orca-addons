// After the Review Workspace moved to a newer merge request head (#58): Review Comments on lines
// that changed since they were written "may be outdated", Agent Findings from an older head are
// stale. Both are recomputed whenever the Review Draft is opened, against the workspace's HEAD.
// GitLab, the orca CLI, git, files and the clock are fakes; Orca's host is the kit's mock host.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import type { ReviewCommentView } from './protocol'
import type { DiffComment } from './seams/orca-cli'
import { CONFIGURED, startWorker as startHarness } from './testing/worker-harness'

const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const REPO = { repoId: 'repo-api', projectId: 'git:gitlab.example.com/acme/api', path: '/src/api' }
const WT_PATH = '/wt/review-api-7'
const WT_ID = `${REPO.repoId}::${WT_PATH}`
const FINDINGS_PATH = `${WT_PATH}/.orca-review/findings.json`

function note(id: string, fields: Partial<DiffComment> = {}): DiffComment {
  return {
    id,
    worktreeId: WT_ID,
    filePath: 'src/login.ts',
    lineNumber: 10,
    body: `note ${id}`,
    createdAt: 1_000,
    side: 'modified',
    scope: 'branch',
    ...fields
  }
}

function arrange(): Fakes {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login' })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WT_PATH, references: [MR_URL] })
  fakes.git.setHead(WT_PATH, 'sha-old')
  return fakes
}

function startWorker(fakes: Fakes) {
  return startHarness(fakes, CONFIGURED, mockHost({ settings: CONFIGURED }))
}

function flags(comments: ReviewCommentView[]) {
  return comments.map((c) => [c.id.startsWith('note:') ? c.id : c.body, c.outdated ?? false, c.stale ?? false])
}

test('after the workspace moved, comments on changed or deleted lines may be outdated; on unchanged lines they are not', async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [
    note('changed', { lineNumber: 10 }),
    note('unchanged', { lineNumber: 40 }),
    note('range-inserted-into', { startLine: 20, lineNumber: 22 }),
    note('after-an-insertion', { lineNumber: 31 }),
    note('deleted-file', { filePath: 'src/gone.ts', lineNumber: 5 }),
    note('renamed-unchanged', { filePath: 'src/old.ts', lineNumber: 3 })
  ])
  const { worker } = await startWorker(fakes)
  const before = await worker.request('rr.draft', { url: MR_URL })
  assert.ok(before.comments.every((c) => !c.outdated && !c.stale), 'nothing is outdated at the head it was written on')
  assert.deepEqual(fakes.git.diffs, [], 'no diff while the workspace is where the comments were written')

  // Update workspace (or anything else) moved the workspace to the merge request's new head.
  fakes.git.setHead(WT_PATH, 'sha-new')
  fakes.git.setFileChanges('sha-old', 'sha-new', [
    { oldPath: 'src/login.ts', newPath: 'src/login.ts', hunks: [{ start: 9, count: 3 }, { start: 21, count: 0 }, { start: 30, count: 0 }] },
    { oldPath: 'src/gone.ts', newPath: null, hunks: [{ start: 1, count: 12 }] },
    { oldPath: 'src/old.ts', newPath: 'src/new.ts', hunks: [{ start: 7, count: 2 }] }
  ])
  const after = await worker.request('rr.draft', { url: MR_URL })

  assert.deepEqual(flags(after.comments), [
    ['note:changed', true, false],
    ['note:unchanged', false, false],
    ['note:range-inserted-into', true, false],
    ['note:after-an-insertion', false, false],
    ['note:deleted-file', true, false],
    // Only the comments' files are diffed, so git can't see where src/old.ts went: it looks deleted.
    ['note:renamed-unchanged', true, false]
  ])
  // Kept, and still made against the commit they were written on.
  assert.ok(after.comments.every((c) => c.sha === 'sha-old' && c.checked))
  assert.deepEqual(
    fakes.git.diffs,
    [{ from: 'sha-old', to: 'sha-new', paths: ['src/login.ts', 'src/gone.ts', 'src/old.ts'] }],
    'one diff per commit the comments were written on, of their files only'
  )
  await worker.deactivate()
})

test('Agent Findings from an older head are stale until a fresh Agent Review; flagged comments can still be curated', async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [note('changed', { lineNumber: 10 })])
  fakes.files.write(
    FINDINGS_PATH,
    JSON.stringify({
      headSha: 'sha-old',
      findings: [{ path: 'src/login.ts', line: 50, body: 'old, unchanged line' }, { body: 'old, general' }]
    })
  )
  const { worker } = await startWorker(fakes)
  await worker.request('rr.draft', { url: MR_URL })

  fakes.git.setHead(WT_PATH, 'sha-new')
  fakes.git.setFileChanges('sha-old', 'sha-new', [
    { oldPath: 'src/login.ts', newPath: 'src/login.ts', hunks: [{ start: 10, count: 1 }] }
  ])
  const after = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(flags(after.comments), [
    ['note:changed', true, false],
    ['old, unchanged line', false, true],
    ['old, general', false, true]
  ])

  // Flagged comments stay curatable: dropped, kept, edited; the flags stay with them.
  const finding = after.comments[1]!.id
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:changed', checked: false })
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: finding, checked: true })
  const edited = await worker.request('rr.updateDraftComment', { url: MR_URL, id: finding, body: 'still true' })
  assert.deepEqual(flags(edited.comments), [
    ['note:changed', true, false],
    ['still true', false, true],
    ['old, general', false, true]
  ])
  assert.deepEqual(edited.comments.map((c) => c.checked), [false, true, false])

  // Run Agent Review wrote fresh findings for the new head: they join, and aren't stale.
  fakes.files.write(
    FINDINGS_PATH,
    JSON.stringify({ headSha: 'sha-new', findings: [{ path: 'src/login.ts', line: 12, body: 'fresh' }] })
  )
  const fresh = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(flags(fresh.comments).at(-1), ['fresh', false, false])
  await worker.deactivate()
})

test("when git can't diff the two commits, the draft says so and flags nothing", async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [note('n1')])
  const { worker } = await startWorker(fakes)
  await worker.request('rr.draft', { url: MR_URL })

  fakes.git.setHead(WT_PATH, 'sha-new')
  fakes.git.failNextOf('fileChanges', new Error('git diff failed: bad object sha-old'))
  const after = await worker.request('rr.draft', { url: MR_URL })

  assert.deepEqual(flags(after.comments), [['note:n1', false, false]])
  assert.deepEqual(after.warnings, [
    "Couldn't tell whether 1 Review Comment written on sha-old may be outdated: git diff failed: bad object sha-old"
  ])
  await worker.deactivate()
})
