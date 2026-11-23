// Posting a Review Draft to GitLab (#30), end to end through the worker: the confirm step's
// preview, drafts against the MR version matching each comment's commit, one published review,
// approve, re-listing and retrying failures, the api-scope hint, and what removal reads.
// GitLab is the stateful fake; nothing reaches a real instance.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { fakeDeps, type Fakes } from './fakes'
import type { FakeMergeRequest } from './fakes/fake-gitlab'
import type { DiffComment } from './seams/orca-cli'
import { GitLabError } from './seams/gitlab'
import { CONFIGURED, startWorker } from './testing/worker-harness'

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

type Arranged = { fakes: Fakes; mr: FakeMergeRequest }

/** MR !7 with a Review Workspace whose HEAD is the MR's head, and the given diff-view notes. */
function arrange(notes: DiffComment[], options: { version?: string } = {}): Arranged {
  const fakes = fakeDeps({ gitlab: options.version ? { version: options.version } : {} })
  const mr = fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login' })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WT_PATH, references: [MR_URL] })
  fakes.git.setHead(WT_PATH, mr.diffRefs.headSha)
  fakes.cli.setDiffComments(WT_ID, notes)
  return { fakes, mr }
}

async function start({ fakes }: Arranged, host = mockHost({ settings: CONFIGURED })) {
  const started = await startWorker(fakes, CONFIGURED, host)
  await started.worker.request('rr.draft', { url: MR_URL })
  return started
}

test('the confirm step counts what posts, lists my leftover GitLab drafts and warns about older versions', async () => {
  const arranged = arrange([note('n1'), note('n2', { filePath: 'src/a.ts', lineNumber: 3 })])
  const { fakes } = arranged
  // A draft I started in GitLab's web UI: bulk_publish would publish it too.
  await fakes.gitlab.rest('POST', '/projects/acme%2Fapi/merge_requests/7/draft_notes', { note: 'Started in the browser' })
  const { worker } = await start(arranged)
  fakes.gitlab.push('acme/api', 7)

  const preview = await worker.request('rr.postPreview', { url: MR_URL })

  assert.equal(preview.comments, 2)
  assert.deepEqual(preview.leftoverDrafts.map((d) => d.body), ['Started in the browser'])
  assert.deepEqual(preview.warnings, [
    'The MR has new commits since 2 Review Comments were written: GitLab may show them as outdated.'
  ])
  await worker.deactivate()
})

test('posting creates line drafts against the matching MR version and publishes one review with the summary and state', async () => {
  const arranged = arrange([note('n1', { startLine: 8, lineNumber: 10, body: 'Reuse the helper?' })])
  const { fakes, mr } = arranged
  fakes.files.write(FINDINGS_PATH, JSON.stringify([{ body: 'Split this MR.' }]))
  const { host, worker } = await start(arranged)
  const [, finding] = (await worker.request('rr.draft', { url: MR_URL })).comments
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: finding!.id, checked: true })
  const notesBefore = host.callsOf('notifications.show').length

  const result = await worker.request('rr.postReview', {
    url: MR_URL,
    summary: 'Nearly there.',
    outcome: 'requested_changes'
  })

  assert.equal(result.posted, 2)
  assert.deepEqual(result.failed, [])
  assert.equal(result.approveError, null)
  assert.deepEqual(fakes.gitlab.reviewsOf('acme/api', 7), [
    { summary: 'Nearly there.', reviewerState: 'requested_changes', notes: ['Reuse the helper?', 'Split this MR.'] }
  ])
  const created = fakes.gitlab.requests.filter((r) => r.operation.endsWith('/draft_notes') && r.body !== undefined)
  assert.deepEqual(created.map((r) => r.body), [
    {
      note: 'Reuse the helper?',
      position: {
        position_type: 'text',
        base_sha: mr.diffRefs.baseSha,
        start_sha: mr.diffRefs.startSha,
        head_sha: mr.diffRefs.headSha,
        old_path: 'src/login.ts',
        new_path: 'src/login.ts',
        new_line: 10
      }
    },
    { note: 'Split this MR.' }
  ])
  assert.deepEqual(result.draft.comments.map((c) => c.posted), [true, true])
  assert.deepEqual(host.callsOf('notifications.show').slice(notesBefore), [
    { title: 'You reviewed Add login', body: '2 comments, changes requested · acme/api !7' }
  ])
  const preview = await worker.request('rr.postPreview', { url: MR_URL })
  assert.equal(preview.comments, 0)
  await worker.deactivate()
})

test('a comment that may be outdated posts on the MR version it was written on, and the confirm step says so (#58)', async () => {
  const arranged = arrange([note('n1', { lineNumber: 10, body: 'Reuse the helper?' })])
  const { fakes, mr } = arranged
  const written = { ...mr.diffRefs }
  // A kept Agent Finding the agent reviewed on a local commit, which is no MR version.
  fakes.files.write(
    FINDINGS_PATH,
    JSON.stringify({ headSha: 'sha-local', findings: [{ path: 'src/login.ts', line: 10, body: 'Expiry?' }] })
  )
  const { worker } = await start(arranged)
  const finding = (await worker.request('rr.draft', { url: MR_URL })).comments[1]!
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: finding.id, checked: true })
  // The MR moved on, and Update workspace followed it; line 10 changed.
  fakes.gitlab.push('acme/api', 7)
  fakes.git.setHead(WT_PATH, mr.diffRefs.headSha)
  for (const from of [written.headSha, 'sha-local']) {
    fakes.git.setFileChanges(from, mr.diffRefs.headSha, [
      { oldPath: 'src/login.ts', newPath: 'src/login.ts', hunks: [{ start: 10, count: 1 }] }
    ])
  }
  const draft = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(draft.comments.map((c) => c.outdated), [true, true])

  // The finding posts as a general comment: only the positioned one is said to post on its version.
  const preview = await worker.request('rr.postPreview', { url: MR_URL })
  assert.deepEqual(preview.warnings, [
    'The MR has new commits since 1 Review Comment was written: GitLab may show it as outdated.',
    '1 Review Comment may be outdated: its lines changed since. It posts on the version it was written on.',
    '1 Review Comment was written against a commit that is no MR version: it posts as general comments starting with path:line.'
  ])

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })
  assert.equal(result.posted, 2)
  const created = fakes.gitlab.requests.filter((r) => r.operation.endsWith('/draft_notes') && r.body !== undefined)
  // Its line exists there, so GitLab can show it in place (as outdated) rather than lose where it was.
  assert.deepEqual(created.map((r) => r.body).slice(0, 1), [
    {
      note: 'Reuse the helper?',
      position: {
        position_type: 'text',
        base_sha: written.baseSha,
        start_sha: written.startSha,
        head_sha: written.headSha,
        old_path: 'src/login.ts',
        new_path: 'src/login.ts',
        new_line: 10
      }
    }
  ])
  await worker.deactivate()
})

test('GitLab 17.4 to 19.1 submits with a /submit_review note carrying the summary', async () => {
  const arranged = arrange([note('n1')], { version: '19.1.3' })
  const { fakes } = arranged
  const { worker } = await start(arranged)

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: 'Thanks!', outcome: 'comment' })

  assert.equal(result.posted, 1)
  assert.deepEqual(fakes.gitlab.reviewsOf('acme/api', 7), [
    { summary: 'Thanks!', reviewerState: 'reviewed', notes: ['note n1'] }
  ])
  assert.equal(fakes.gitlab.requests.some((r) => r.operation.endsWith('/bulk_publish')), false)
  await worker.deactivate()
})

test('Approve publishes the review, then approves the current head', async () => {
  const arranged = arrange([note('n1')])
  const { fakes, mr } = arranged
  const { worker } = await start(arranged)

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'approve' })

  assert.equal(result.approveError, null)
  assert.deepEqual(mr.approvedBy, ['me'])
  const approve = fakes.gitlab.requests.find((r) => r.operation.endsWith('/approve'))
  assert.deepEqual(approve?.body, { sha: mr.diffRefs.headSha })
  assert.deepEqual(fakes.gitlab.reviewsOf('acme/api', 7).map((r) => r.notes), [['note n1']])
  await worker.deactivate()
})

test('an approved review moves to Done right away, without waiting for the next poll', async () => {
  const arranged = arrange([note('n1')])
  const { worker } = await start(arranged)

  await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'approve' })

  const snapshot = await worker.request('rr.snapshot')
  assert.deepEqual(snapshot.reviewRequests.map((rr) => rr.iid), [])
  assert.deepEqual(snapshot.ended?.map((e) => [e.iid, e.reason]), [[7, 'approved']])
  await worker.deactivate()
})

test('a review posted as Request changes moves to Done right away (#78)', async () => {
  const arranged = arrange([note('n1')])
  const { worker } = await start(arranged)

  await worker.request('rr.postReview', { url: MR_URL, summary: 'Two things.', outcome: 'requested_changes' })

  const snapshot = await worker.request('rr.snapshot')
  assert.deepEqual(snapshot.reviewRequests.map((rr) => rr.iid), [])
  assert.deepEqual(snapshot.ended?.map((e) => [e.iid, e.reason]), [[7, 'changes-requested']])
  await worker.deactivate()
})

test('posting clears what was not checked; imports keep it out until a note is edited in Orca (#81)', async () => {
  const arranged = arrange([note('kept'), note('left', { body: 'not for GitLab' })])
  const { fakes } = arranged
  fakes.files.write(FINDINGS_PATH, JSON.stringify([{ body: 'Split this MR.' }, { body: 'Rename this.' }]))
  const { worker } = await start(arranged)
  const draft = await worker.request('rr.draft', { url: MR_URL })
  const split = draft.comments.find((c) => c.body === 'Split this MR.')!
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: split.id, checked: true })
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:left', checked: false })

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })

  assert.equal(result.posted, 2)
  const after = (d: { comments: { id: string; body: string; posted: boolean; checked: boolean }[] }) =>
    d.comments.map((c) => [c.body, c.posted, c.checked])
  assert.deepEqual(
    after(result.draft),
    [
      ['note kept', true, true],
      ['Split this MR.', true, true]
    ],
    'the unchecked note and finding are gone; the posted ones stay'
  )
  assert.deepEqual(after(await worker.request('rr.draft', { url: MR_URL })), after(result.draft), 'a re-import keeps them out')

  fakes.cli.setDiffComments(WT_ID, [note('kept'), note('left', { body: 'reworded', updatedAt: 5_000 })])
  const edited = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(
    edited.comments.find((c) => c.id === 'note:left')?.checked,
    false,
    'an edited note is back, unchecked'
  )
  assert.equal(edited.comments.some((c) => c.body === 'Rename this.'), false, 'a deleted finding stays deleted')
  await worker.deactivate()
})

test('a post where some comments did not publish clears nothing (#81)', async () => {
  const arranged = arrange([note('n1', { body: 'never publishes' }), note('n2'), note('n3')])
  arranged.fakes.gitlab.refuseToPublish('acme/api', 7, 'never')
  const { worker } = await start(arranged)
  await worker.request('rr.updateDraftComment', { url: MR_URL, id: 'note:n3', checked: false })

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })

  assert.equal(result.failed.length, 1)
  assert.equal(result.draft.comments.find((c) => c.id === 'note:n3')?.checked, false, 'still there, unchecked')
  await worker.deactivate()
})

test('a review posted as Comment stays a Review Request', async () => {
  const arranged = arrange([note('n1')])
  const { worker } = await start(arranged)

  await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })

  assert.deepEqual((await worker.request('rr.snapshot')).reviewRequests.map((rr) => rr.iid), [7])
  await worker.deactivate()
})

test('a comment whose commit is no MR version posts as a general path:line comment', async () => {
  const arranged = arrange([note('n1', { lineNumber: 4, body: 'Off by one.' })])
  const { fakes } = arranged
  fakes.git.setHead(WT_PATH, 'f'.repeat(40))
  const { worker } = await start(arranged)

  const preview = await worker.request('rr.postPreview', { url: MR_URL })
  assert.deepEqual(preview.warnings, [
    '1 Review Comment was written against a commit that is no MR version: it posts as general comments starting with path:line.'
  ])
  await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })

  assert.deepEqual(fakes.gitlab.reviewsOf('acme/api', 7)[0]!.notes, ['`src/login.ts:4`\n\nOff by one.'])
  await worker.deactivate()
})

test('a line comment that does not publish is retried once as a general path:line comment', async () => {
  const arranged = arrange([note('n1', { lineNumber: 99, body: 'Stale line.' }), note('n2')])
  const { fakes } = arranged
  fakes.gitlab.outsideDiff('acme/api', 7, 'src/login.ts', 99)
  const { worker } = await start(arranged)

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: 'Summary', outcome: 'comment' })

  assert.equal(result.posted, 2)
  assert.deepEqual(result.failed, [])
  assert.deepEqual(fakes.gitlab.reviewsOf('acme/api', 7).map((r) => [r.summary, r.notes]), [
    ['Summary', ['note n2']],
    [null, ['`src/login.ts:99`\n\nStale line.']]
  ])
  assert.deepEqual(fakes.gitlab.draftNotesOf('acme/api', 7), [])
  await worker.deactivate()
})

test('what still fails stays in the Review Draft with its GitLab draft; posting again replaces that draft', async () => {
  const arranged = arrange([note('n1', { body: 'never publishes' }), note('n2')])
  const { fakes } = arranged
  fakes.gitlab.refuseToPublish('acme/api', 7, 'never')
  const { worker } = await start(arranged)

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })

  assert.equal(result.posted, 1)
  assert.deepEqual(result.failed.map((f) => [f.commentId, f.location]), [['note:n1', 'src/login.ts:10']])
  assert.match(result.failed[0]!.message, /did not publish/)
  const failedComment = result.draft.comments.find((c) => c.id === 'note:n1')!
  assert.equal(failedComment.posted, false)
  assert.match(failedComment.failure ?? '', /did not publish/)
  assert.equal(fakes.gitlab.draftNotesOf('acme/api', 7).length, 1, 'GitLab keeps the failed draft')

  const preview = await worker.request('rr.postPreview', { url: MR_URL })
  assert.equal(preview.comments, 1)
  assert.deepEqual(preview.leftoverDrafts, [], "our own failed draft isn't listed as someone else's leftover")
  assert.deepEqual(preview.warnings, ['1 draft the last post left on GitLab will be replaced.'])

  fakes.gitlab.refuseToPublish('acme/api', 7, 'nothing-matches-this')
  const again = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })
  assert.equal(again.failed.length, 1, 'still refused')
  assert.equal(fakes.gitlab.draftNotesOf('acme/api', 7).length, 1, 'replaced, not duplicated')
  await worker.deactivate()
})

test('Delete failed drafts removes only the drafts the last post left; the comments stay', async () => {
  const arranged = arrange([note('n1', { body: 'never publishes' })])
  const { fakes } = arranged
  fakes.gitlab.refuseToPublish('acme/api', 7, 'never')
  await fakes.gitlab.rest('POST', '/projects/acme%2Fapi/merge_requests/7/draft_notes', { note: 'mine from the browser' })
  const { worker } = await start(arranged)
  await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })
  // The browser draft was published with the review; add another to prove it is left alone.
  await fakes.gitlab.rest('POST', '/projects/acme%2Fapi/merge_requests/7/draft_notes', { note: 'another from the browser' })

  const draft = await worker.request('rr.deleteFailedDrafts', { url: MR_URL })

  assert.deepEqual(fakes.gitlab.draftNotesOf('acme/api', 7).map((d) => d.note), ['another from the browser'])
  assert.deepEqual(draft.comments.map((c) => [c.id, c.posted, c.failure]), [['note:n1', false, undefined]])
  await worker.deactivate()
})

test('GitLab publishing the comments but answering 500 (gitlab.com 19.7): they count as posted, the summary and state follow once', async () => {
  const arranged = arrange([note('n1', { body: 'Line comment.' }), note('n2', { lineNumber: 12, body: 'Other line.' })])
  const { fakes, mr } = arranged
  fakes.gitlab.failNextPublish('acme/api', 7, 'notes-published')
  const { worker } = await start(arranged)

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: 'See comments', outcome: 'requested_changes' })

  assert.equal(result.posted, 2)
  assert.deepEqual(result.failed, [])
  assert.deepEqual(result.draft.comments.map((c) => c.posted), [true, true])
  assert.deepEqual(fakes.gitlab.draftNotesOf('acme/api', 7), [], 'the drafts GitLab kept after publishing are deleted')
  assert.deepEqual(mr.published.map((n) => n.body), ['Line comment.', 'Other line.', 'See comments'], 'each once')
  assert.equal(mr.reviewStates[fakes.gitlab.me], 'REQUESTED_CHANGES')

  const again = await worker.request('rr.postPreview', { url: MR_URL })
  assert.equal(again.comments, 0)
  assert.deepEqual(again.leftoverDrafts, [], 'nothing left that a retry would post twice')
  await worker.deactivate()
})

test('GitLab answering 500 without publishing: the error shows, the new drafts are gone and a retry posts each comment once', async () => {
  const arranged = arrange([note('n1', { body: 'Line comment.' })])
  const { fakes, mr } = arranged
  fakes.gitlab.failNextPublish('acme/api', 7, 'nothing-published')
  const { worker } = await start(arranged)

  const error = await worker.request('rr.postReview', { url: MR_URL, summary: 'Hm', outcome: 'comment' }).then(
    () => null,
    (e: unknown) => e as Error
  )

  assert.match(error?.message ?? '', /500 Internal Server Error/)
  assert.deepEqual(fakes.gitlab.draftNotesOf('acme/api', 7), [])
  assert.equal(mr.published.length, 0)
  assert.equal((await worker.request('rr.draft', { url: MR_URL })).comments[0]!.posted, false)

  const retried = await worker.request('rr.postReview', { url: MR_URL, summary: 'Hm', outcome: 'comment' })
  assert.equal(retried.posted, 1)
  assert.deepEqual(mr.published.map((n) => n.body), ['Line comment.', 'Hm'])
  await worker.deactivate()
})

test('a token without the api scope gets the api-scope hint, with the token redacted', async () => {
  const arranged = arrange([note('n1')])
  const { fakes } = arranged
  fakes.gitlab.issueToken('glpat-READONLY', ['read_api'])
  const host = mockHost({ settings: CONFIGURED, secrets: { 'token:gitlab.example.com': 'glpat-READONLY' } })
  const { worker } = await start(arranged, host)

  const error = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' }).then(
    () => null,
    (e: unknown) => e as Error
  )

  assert.match(error?.message ?? '', /needs a token with the api scope/)
  assert.equal((error?.message ?? '').includes('glpat-READONLY'), false)
  assert.deepEqual(fakes.gitlab.reviewsOf('acme/api', 7), [])
  const draft = await worker.request('rr.draft', { url: MR_URL })
  assert.equal(draft.comments[0]!.posted, false)
  await worker.deactivate()
})

test('a failed approval is reported; the review itself is posted', async () => {
  const arranged = arrange([note('n1')])
  const { fakes } = arranged
  const { worker } = await start(arranged)
  // The head moves between reading the MR and approving: GitLab refuses the stale SHA.
  const realRest = fakes.gitlab.rest.bind(fakes.gitlab)
  let pushed = false
  fakes.gitlab.rest = (async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: never) => {
    if (path.endsWith('/approve') && !pushed) {
      pushed = true
      fakes.gitlab.push('acme/api', 7)
    }
    return realRest(method, path, body)
  }) as typeof fakes.gitlab.rest

  const result = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'approve' })

  assert.equal(result.posted, 1)
  assert.match(result.approveError ?? '', /SHA does not match/)
  await worker.deactivate()
})

/** A host whose `workspace.list` reports the Review Workspace idle, so only the draft can block removal. */
function idleHost() {
  return mockHost({
    settings: CONFIGURED,
    results: {
      'workspace.list': {
        workspaces: [
          {
            id: 'ws-review',
            kind: 'worktree',
            name: 'review-api-7',
            path: WT_PATH,
            branch: null,
            hostId: 'local',
            status: { state: 'inactive', terminalCount: 0, unread: false, lastActivityAt: 0 }
          }
        ],
        truncated: false
      }
    }
  })
}

async function endedWithDraft(notes: DiffComment[]) {
  const arranged = arrange(notes)
  const started = await start(arranged, idleHost())
  arranged.fakes.gitlab.merge('acme/api', 7)
  await arranged.fakes.clock.advance(5 * 60_000)
  return { ...arranged, ...started }
}

test('an Ended Review Request still opens and posts its Review Draft', async () => {
  const { fakes, worker } = await endedWithDraft([note('n1')])

  const draft = await worker.request('rr.draft', { url: MR_URL })
  assert.deepEqual(draft.comments.map((c) => c.id), ['note:n1'])
  const result = await worker.request('rr.postReview', { url: MR_URL, summary: '', outcome: 'comment' })
  assert.equal(result.posted, 1)
  assert.equal(fakes.gitlab.reviewsOf('acme/api', 7).length, 1)
  await worker.deactivate()
})

test('removing the Review Workspace discards its Review Draft', async () => {
  const { host, worker } = await endedWithDraft([note('n1')])

  await worker.request('rr.removeWorkspace', { url: MR_URL })

  const keys = await (async () => {
    let storage: { keys(): Promise<string[]> } | undefined
    await mountWorker({ default: (api: OrcaWorkerApi) => void (storage = api.storage) }, { host })
    return storage!.keys()
  })()
  assert.equal(keys.some((k) => k.startsWith('reviewDraft:')), false)
  await worker.deactivate()
})

test('removing the workspace of a review in progress: forced, then the card is back in Todo without a draft (#80)', async () => {
  const arranged = arrange([note('n1')])
  const idle = mockHost({ settings: CONFIGURED, results: { 'workspace.list': { workspaces: [], truncated: false } } })
  const { host, worker } = await start(arranged, idle)

  const snapshot = await worker.request('rr.removeWorkspace', { url: MR_URL })

  assert.deepEqual(
    arranged.fakes.cli.calls.filter((c) => c.command === 'worktree rm').map((c) => c.args),
    [{ selector: `id:${WT_ID}`, deleteBranch: true, force: true }]
  )
  assert.deepEqual(snapshot.reviewRequests.map((c) => [c.iid, c.workspace ?? null]), [[7, null]], 'a Review Request again, under Todo')
  assert.equal(snapshot.ended, undefined, 'not a Done entry')
  const keys = await (async () => {
    let storage: { keys(): Promise<string[]> } | undefined
    await mountWorker({ default: (api: OrcaWorkerApi) => void (storage = api.storage) }, { host })
    return storage!.keys()
  })()
  assert.equal(keys.some((k) => k.startsWith('reviewDraft:')), false)
  await worker.deactivate()
})

test('nothing checked, no summary and Comment: refused, nothing written', async () => {
  const arranged = arrange([])
  const { fakes } = arranged
  const { worker } = await start(arranged)
  const before = fakes.gitlab.requests.length

  await assert.rejects(worker.request('rr.postReview', { url: MR_URL, summary: '  ', outcome: 'comment' }), /Nothing to post/)
  assert.equal(fakes.gitlab.requests.slice(before).some((r) => !r.operation.startsWith('GET')), false)
  await worker.deactivate()
})

/** The Review Draft URLs in the plugin's storage on `host`, as another worker of the plugin sees them. */
async function draftUrls(host: ReturnType<typeof mockHost>): Promise<string[]> {
  let storage: { keys(): Promise<string[]> } | undefined
  await mountWorker({ default: (api: OrcaWorkerApi) => void (storage = api.storage) }, { host })
  return (await storage!.keys()).filter((k) => k.startsWith('reviewDraft:')).map((k) => k.slice('reviewDraft:'.length))
}

const POLL = 5 * 60_000

test('a Review Draft whose workspace was deleted outside the plugin is swept on the next poll', async () => {
  const arranged = arrange([note('n1')])
  const { host, worker } = await start(arranged)
  assert.deepEqual(await draftUrls(host), [MR_URL])

  // Deleted in Orca's UI or with the CLI, not through the panel.
  await arranged.fakes.cli.removeWorktree(`id:${WT_ID}`)
  await arranged.fakes.clock.advance(POLL)

  assert.deepEqual(await draftUrls(host), [])
  await worker.deactivate()
})

test('a merge request made draft drops off the list but keeps its Review Draft while its workspace is there', async () => {
  const arranged = arrange([note('n1')])
  const { host, worker } = await start(arranged)

  arranged.fakes.gitlab.markDraft('acme/api', 7)
  await arranged.fakes.clock.advance(POLL)

  assert.deepEqual((await worker.request('rr.snapshot')).reviewRequests, [])
  assert.deepEqual(await draftUrls(host), [MR_URL])
  await worker.deactivate()
})

test('while workspaces cannot be listed, no Review Draft is swept', async () => {
  const arranged = arrange([note('n1')])
  const { host, worker } = await start(arranged)
  const cli = arranged.fakes.cli
  await cli.removeWorktree(`id:${WT_ID}`)
  cli.listWorktrees = async () => {
    throw new Error('Orca is not running')
  }

  await arranged.fakes.clock.advance(POLL)

  assert.deepEqual(await draftUrls(host), [MR_URL])
  await worker.deactivate()
})
