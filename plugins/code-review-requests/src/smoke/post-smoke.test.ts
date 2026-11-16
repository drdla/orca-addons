// The live smoke script's `--post` run (#31), against the stateful fake GitLab only: a line
// comment and a general comment posted as one Review Draft through the plugin's own poster, then
// the published notes reported. It says what it will do first, and writes nothing until confirmed.
import { assert, test } from 'orca/testing'
import { FakeGitLab } from '../fakes'
import type { FakeMergeRequest } from '../fakes/fake-gitlab'
import { runPostSmoke, type PostSmokeOptions } from './post-smoke'

const URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const TARGET = { url: URL, host: 'gitlab.example.com', projectPath: 'acme/api', iid: 7 }
const TAG = 'crr-smoke-1'

const DIFF = ['@@ -1,3 +1,4 @@', ' line one', '-old', '+new a', '+new b', ' line three', ''].join('\n')

type Arranged = { gitlab: FakeGitLab; mr: FakeMergeRequest; options: PostSmokeOptions; plans: string[] }

function arrange(overrides: Partial<PostSmokeOptions> = {}, gitlabOptions: { version?: string } = {}): Arranged {
  const gitlab = new FakeGitLab(gitlabOptions)
  const mr = gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7 })
  gitlab.setDiffs('acme/api', 7, [
    { old_path: 'gone.ts', new_path: 'gone.ts', diff: '@@ -1 +0,0 @@\n-x\n', deleted_file: true },
    { old_path: 'src/login.ts', new_path: 'src/login.ts', diff: DIFF }
  ])
  const plans: string[] = []
  const options: PostSmokeOptions = {
    transport: gitlab,
    target: TARGET,
    approve: false,
    line: null,
    tag: TAG,
    now: () => 1_000,
    confirm: async (plan) => {
      plans.push(plan)
      return true
    },
    ...overrides
  }
  return { gitlab, mr, options, plans }
}

const writes = (gitlab: FakeGitLab) => gitlab.requests.filter((r) => /^(POST|PUT|DELETE) /.test(r.operation))

test('says what it will post, then publishes a line and a general comment as one review', async () => {
  const { gitlab, mr, options, plans } = arrange()
  const result = await runPostSmoke(options)

  assert.equal(plans.length, 1)
  assert.match(plans[0]!, new RegExp(URL))
  assert.match(plans[0]!, /src\/login\.ts:2/)
  assert.match(plans[0]!, /General comment/)
  assert.match(plans[0]!, /Approve: +no/)

  assert.equal(result.outcome, 'posted')
  assert.deepEqual(
    result.checks.map((c) => [c.name, c.status]),
    [
      ['Drafts published', 'pass'],
      ['Line comment', 'pass'],
      ['General comment', 'pass'],
      ['Summary', 'pass'],
      ['No drafts left', 'pass']
    ]
  )
  const line = result.checks.find((c) => c.name === 'Line comment')!
  assert.match(line.detail, new RegExp(`${URL}#note_\\d+`))
  assert.match(line.detail, /diff note on src\/login\.ts:2/)

  const [review] = gitlab.reviewsOf('acme/api', 7)
  assert.equal(review!.notes.length, 2)
  assert.ok(review!.notes.every((n) => n.includes(TAG)))
  assert.match(review!.summary ?? '', new RegExp(TAG))
  assert.deepEqual(mr.approvedBy, [])
})

test('--file/--line puts the line comment there instead of the first added line', async () => {
  const { gitlab, options } = arrange({ line: { path: 'src/other.ts', line: 40 } })
  await runPostSmoke(options)
  const positions = gitlab.requests
    .filter((r) => r.operation.endsWith('/draft_notes') && r.operation.startsWith('POST'))
    .map((r) => (r.body as { position?: { new_path: string; new_line: number } }).position)
  assert.deepEqual(positions.map((p) => p && `${p.new_path}:${p.new_line}`), ['src/other.ts:40', undefined])
})

test('--approve approves the MR at its head commit', async () => {
  const { mr, options, plans } = arrange({ approve: true })
  const result = await runPostSmoke(options)
  assert.match(plans[0]!, /Approve: +yes/)
  assert.equal(result.checks.find((c) => c.name === 'Approved')?.status, 'pass')
  assert.deepEqual(mr.approvedBy, ['me'])
})

test('a declined confirmation writes nothing', async () => {
  const { gitlab, options } = arrange({ confirm: async () => false })
  const result = await runPostSmoke(options)
  assert.equal(result.outcome, 'cancelled')
  assert.deepEqual(writes(gitlab), [])
})

test('refuses, before writing, when my own drafts are pending on the MR: they would publish too', async () => {
  const { gitlab, options, plans } = arrange()
  gitlab.draftNotesOf('acme/api', 7).push({ id: 99, author: 'me', note: 'Started in the browser', position: null })
  await assert.rejects(runPostSmoke(options), /1 pending draft/)
  assert.deepEqual(plans, [])
  assert.deepEqual(writes(gitlab), [])
})

test('refuses an MR that is not open, or a diff without an added line', async () => {
  const closed = arrange()
  closed.gitlab.close('acme/api', 7)
  await assert.rejects(runPostSmoke(closed.options), /is closed/)

  const noLine = arrange()
  noLine.gitlab.setDiffs('acme/api', 7, [{ old_path: 'a.ts', new_path: 'a.ts', diff: '@@ -1,2 +1,1 @@\n-x\n y\n' }])
  await assert.rejects(runPostSmoke(noLine.options), /--file <path> --line <n>/)
  assert.deepEqual([...writes(closed.gitlab), ...writes(noLine.gitlab)], [])
})

test('a line comment GitLab keeps as a draft is reported, not hidden', async () => {
  const { gitlab, options } = arrange()
  gitlab.outsideDiff('acme/api', 7, 'src/login.ts', 2)
  const result = await runPostSmoke(options)
  // The poster retries it once as a general comment; that one publishes.
  const line = result.checks.find((c) => c.name === 'Line comment')!
  assert.equal(line.status, 'fail')
  assert.match(line.detail, /general note/)
})

test('before 19.2 the review is published with a /submit_review note, which carries the summary', async () => {
  const { gitlab, options } = arrange({}, { version: '18.4.0' })
  const result = await runPostSmoke(options)
  assert.equal(result.checks.find((c) => c.name === 'Summary')?.status, 'pass')
  assert.ok(gitlab.requests.some((r) => r.operation === 'POST /projects/acme%2Fapi/merge_requests/7/notes'))
})
