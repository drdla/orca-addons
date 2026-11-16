// The Review Draft end to end through the worker (#29): importing Orca's diff-view notes and the
// Agent Findings into it, curating it, and what posting (#30) and removal (#28) read from it.
// GitLab, the orca CLI, git, files and the clock are fakes; Orca's host is the kit's mock host.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { fakeDeps, type Fakes } from './fakes'
import type { ReviewCommentView } from './protocol'
import { createReviewDrafts } from './review-draft/review-drafts'
import type { DiffComment } from './seams/orca-cli'
import { OrcaCliError } from './seams/orca-cli'
import { createWorker } from './worker'

const CONFIGURED = { instanceUrl: 'https://gitlab.example.com', pollMinutes: 5 }
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

function arrange(options: { workspace?: boolean } = {}): Fakes {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login' })
  fakes.cli.addRepo(REPO)
  if (options.workspace !== false) {
    fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WT_PATH, references: [MR_URL] })
    fakes.git.setHead(WT_PATH, 'sha-head')
  }
  return fakes
}

async function startWorker(fakes: Fakes, host = mockHost({ settings: CONFIGURED })) {
  const worker = await mountWorker(createWorker(fakes.deps), { host })
  await fakes.clock.advance(0)
  return { host, worker }
}

/** The plugin's storage on `host`, as another worker of the plugin (#28, #30) sees it. */
async function storageOf(host: ReturnType<typeof mockHost>): Promise<OrcaWorkerApi['storage']> {
  let storage: OrcaWorkerApi['storage'] | undefined
  await mountWorker({ default: (api: OrcaWorkerApi) => void (storage = api.storage) }, { host })
  return storage!
}

function byId(comments: ReviewCommentView[], id: string): ReviewCommentView {
  const found = comments.find((c) => c.id === id)
  assert.ok(found, `no comment ${id} in ${comments.map((c) => c.id).join(', ')}`)
  return found!
}

test('opening the Review Draft imports diff-view notes (checked, read-only) and Agent Findings (unchecked, editable)', async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [
    note('n1', { startLine: 8, lineNumber: 10, body: 'Why not reuse the helper?', updatedAt: 2_000 }),
    note('n2', { source: 'markdown', selectedText: 'x' }),
    note('n3', { scope: 'unstaged' })
  ])
  fakes.files.write(
    FINDINGS_PATH,
    JSON.stringify({
      headSha: 'sha-reviewed',
      findings: [{ path: 'src/login.ts', line: 30, body: 'Token expiry is not checked.' }, { body: 'Split this MR.' }, 42]
    })
  )
  const { worker } = await startWorker(fakes)

  const draft = await worker.request('rr.draft', { url: MR_URL })

  assert.equal(draft.url, MR_URL)
  assert.equal(draft.title, 'Add login')
  assert.equal(draft.workspace?.path, WT_PATH)
  assert.deepEqual(
    draft.comments.map((c) => [c.origin, c.filePath, c.line, c.checked, c.editable, c.sha, c.posted]),
    [
      ['diff-note', 'src/login.ts', 10, true, false, 'sha-head', false],
      ['agent-finding', 'src/login.ts', 30, false, true, 'sha-reviewed', false],
      ['agent-finding', null, null, false, true, 'sha-reviewed', false]
    ]
  )
  assert.equal(draft.comments[0]!.startLine, 8)
  assert.equal(draft.comments[0]!.body, 'Why not reuse the helper?')
  assert.deepEqual(draft.warnings, [
    'Agent Finding 3 skipped: not an object.',
    '1 diff-view note on uncommitted changes skipped: GitLab only has committed code.'
  ])
  assert.equal(draft.importedAt, fakes.clock.now())
  await worker.deactivate()
})

test('checking a finding and editing its body last across a worker restart', async () => {
  const fakes = arrange()
  fakes.files.write(FINDINGS_PATH, JSON.stringify({ findings: [{ path: 'a.ts', line: 1, body: 'first' }] }))
  const first = await startWorker(fakes)
  const [finding] = (await first.worker.request('rr.draft', { url: MR_URL })).comments

  await first.worker.request('rr.updateDraftComment', { url: MR_URL, id: finding!.id, checked: true })
  const edited = await first.worker.request('rr.updateDraftComment', { url: MR_URL, id: finding!.id, body: 'better' })
  assert.deepEqual([edited.comments[0]!.checked, edited.comments[0]!.body], [true, 'better'])
  await first.worker.deactivate()

  const second = await startWorker(fakes, first.host)
  const again = await second.worker.request('rr.draft', { url: MR_URL })
  assert.equal(again.comments.length, 1, 're-importing the same file adds nothing')
  assert.deepEqual([again.comments[0]!.checked, again.comments[0]!.body], [true, 'better'])
  // The finding was imported without a headSha: it takes the workspace's commit.
  assert.equal(again.comments[0]!.sha, 'sha-head')
  await second.worker.deactivate()
})

test('a diff-view note can be unchecked but not edited: edit it in Orca', async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [note('n1')])
  const { worker } = await startWorker(fakes)
  await worker.request('rr.draft', { url: MR_URL })

  const unchecked = await worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:n1', checked: false })
  assert.equal(unchecked.comments[0]!.checked, false)
  await assert.rejects(worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:n1', body: 'changed' }), /edit it in Orca/i)
  await worker.deactivate()
})

test('importing again follows Orca: edited notes change, deleted ones go, new findings join', async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [note('n1'), note('n2')])
  fakes.files.write(FINDINGS_PATH, JSON.stringify([{ body: 'old finding' }]))
  const { worker } = await startWorker(fakes)
  await worker.request('rr.draft', { url: MR_URL })
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:n1', checked: false })

  fakes.cli.setDiffComments(WT_ID, [note('n1', { body: 'reworded', updatedAt: 5_000 }), note('n4')])
  fakes.files.write(FINDINGS_PATH, JSON.stringify([{ body: 'old finding' }, { body: 'new finding' }]))
  const draft = await worker.request('rr.draft', { url: MR_URL })

  assert.deepEqual(
    draft.comments.map((c) => [c.id.startsWith('note:') ? c.id : c.body, c.checked]),
    [
      ['note:n1', false],
      ['note:n4', true],
      ['old finding', false],
      ['new finding', false]
    ]
  )
  assert.equal(byId(draft.comments, 'note:n1').body, 'reworded')
  await worker.deactivate()
})

test('without a Review Workspace the draft says so and calls nothing', async () => {
  const fakes = arrange({ workspace: false })
  const { worker } = await startWorker(fakes)
  const cliCalls = fakes.cli.calls.length

  const draft = await worker.request('rr.draft', { url: MR_URL })

  assert.equal(draft.workspace, null)
  assert.deepEqual(draft.comments, [])
  assert.deepEqual(draft.warnings, ['This Review Request has no Review Workspace, so there is nothing to import.'])
  assert.equal(fakes.cli.calls.length, cliCalls)
  await worker.deactivate()
})

test('a failing orca CLI keeps the notes from the last import and says why', async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [note('n1')])
  const { worker } = await startWorker(fakes)
  await worker.request('rr.draft', { url: MR_URL })

  fakes.cli.failNext(new OrcaCliError('unavailable', 'Orca is not running'))
  const draft = await worker.request('rr.draft', { url: MR_URL })

  assert.deepEqual(draft.comments.map((c) => c.id), ['note:n1'])
  assert.deepEqual(draft.warnings, ["Couldn't read the diff-view notes: Orca is not running"])
  await worker.deactivate()
})

test('an unknown Review Request is refused', async () => {
  const fakes = arrange()
  const { worker } = await startWorker(fakes)
  await assert.rejects(worker.request('rr.draft', { url: 'https://gitlab.example.com/x/-/merge_requests/1' }), /not a Review Request/i)
  await worker.deactivate()
})

test('posting (#30) reads the checked comments, marks them posted; an edit in Orca makes a note unposted again', async () => {
  const fakes = arrange()
  fakes.cli.setDiffComments(WT_ID, [note('n1', { updatedAt: 2_000 }), note('n2')])
  fakes.files.write(FINDINGS_PATH, JSON.stringify([{ body: 'finding' }]))
  const { host, worker } = await startWorker(fakes)
  await worker.request('rr.draft', { url: MR_URL })
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:n2', checked: false })

  const drafts = createReviewDrafts(await storageOf(host), fakes.clock)
  assert.equal(await drafts.hasUnposted(MR_URL), true)
  const toPost = await drafts.toPost(MR_URL)
  assert.deepEqual(toPost.map((c) => [c.id, c.sha, c.filePath, c.line]), [['note:n1', 'sha-head', 'src/login.ts', 10]])

  await drafts.markPosted(MR_URL, [{ commentId: 'note:n1', noteId: 501, updatedAt: toPost[0]!.updatedAt }])
  assert.equal(await drafts.hasUnposted(MR_URL), false)
  const after = await worker.request('rr.draft', { url: MR_URL })
  assert.equal(byId(after.comments, 'note:n1').posted, true)
  await assert.rejects(worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:n1', checked: false }), /already posted/i)

  fakes.cli.setDiffComments(WT_ID, [note('n1', { updatedAt: 9_000, body: 'edited after posting' }), note('n2')])
  const edited = await worker.request('rr.draft', { url: MR_URL })
  assert.equal(byId(edited.comments, 'note:n1').posted, false)
  assert.equal(await drafts.hasUnposted(MR_URL), true)
  await worker.deactivate()
})

test('an MR without a Review Draft has nothing unposted', async () => {
  const fakes = arrange()
  const { host, worker } = await startWorker(fakes)
  const drafts = createReviewDrafts(await storageOf(host), fakes.clock)
  assert.equal(await drafts.hasUnposted(MR_URL), false)
  assert.deepEqual(await drafts.toPost(MR_URL), [])
  await worker.deactivate()
})
