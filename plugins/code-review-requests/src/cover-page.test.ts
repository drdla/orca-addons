// The Review Cover Page end to end through the worker (#55): Start review builds it from GitLab
// and opens it in Orca's main view, Open workspace builds it when missing, and the Review Draft
// reopens it. GitLab, the orca CLI, git, files and the clock are fakes; Orca's host is the kit's
// mock host.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import { GitLabError } from './seams/gitlab'
import { CONFIGURED, startWorker as startHarness } from './testing/worker-harness'

const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const REPO = { repoId: 'repo-api', projectId: 'git:gitlab.example.com/acme/api', path: '/src/api' }
const WORKTREE = '/worktrees/review-api-7'
const PAGE = `${WORKTREE}/.orca-review/merge-request.md`
const EXCLUDE = `${WORKTREE}/.git/info/exclude`

async function startWorker(fakes: Fakes, workspaces: string[] = ['/src/api', WORKTREE]) {
  const host = mockHost({
    settings: CONFIGURED,
    results: {
      'workspace.list': {
        workspaces: workspaces.map((path, i) => ({
          id: `ws-${i}`,
          kind: 'worktree' as const,
          name: path.split('/').at(-1)!,
          path,
          branch: null,
          hostId: 'local'
        })),
        truncated: false
      },
      'agent.launch': { terminalId: 'term-agent' },
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  return startHarness(fakes, CONFIGURED, host)
}

function addReviewRequest(fakes: Fakes) {
  fakes.gitlab.addMergeRequest({
    projectPath: 'acme/api',
    iid: 7,
    title: 'Add login',
    author: 'ada',
    sourceBranch: 'feature/login',
    targetBranch: 'main',
    description: 'Adds a login form.'
  })
  fakes.gitlab.setDiffs('acme/api', 7, [
    { old_path: 'src/login.ts', new_path: 'src/login.ts', diff: '@@ -1 +1 @@\n-a\n+b\n' }
  ])
}

test('Start review builds the cover page from GitLab, keeps it out of Source Control and opens it', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes)

  await worker.request('rr.startReview', { url: MR_URL, withAgent: false })

  const page = fakes.files.peek(PAGE) ?? ''
  assert.match(page, /^# Add login\n/)
  assert.match(page, /Adds a login form\./)
  assert.match(page, /\| `src\/login\.ts` \| modified \| \+1 \| -1 \|/)
  assert.equal(fakes.files.peek(EXCLUDE), '.orca-review/\n')
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: '.orca-review/merge-request.md' }])
  await worker.deactivate()
})

test('with an Agent Review, the agent launches without waiting for the page, and the page opens last, in front', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes)

  await worker.request('rr.startReview', { url: MR_URL, withAgent: true })

  const order = host.calls.map((c) => c.method).filter((m) => m === 'agent.launch' || m === 'editor.open')
  assert.deepEqual(order, ['agent.launch', 'editor.open'])
  assert.match(fakes.files.peek(PAGE) ?? '', /^# Add login\n/)
  await worker.deactivate()
})

test("the page records the workspace's checked-out commit and the workspace's own Linear link", async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({
    name: 'review-api-7',
    repoId: REPO.repoId,
    path: WORKTREE,
    references: [MR_URL],
    linearIssue: { identifier: 'OEO-9', url: 'https://linear.app/acme/issue/OEO-9/login' }
  })
  const checkedOut = 'c0ffee0000000000000000000000000000000000'
  fakes.git.setHead(WORKTREE, checkedOut)
  fakes.gitlab.push('acme/api', 7)
  const { worker } = await startWorker(fakes)

  await worker.request('rr.openCoverPage', { url: MR_URL })

  const page = fakes.files.peek(PAGE) ?? ''
  assert.ok(page.includes(`<!-- orca-review-cover-page head=${checkedOut} -->`), page)
  assert.match(page, /^# Add login\n\n> \*\*Merge request updated\.\*\* New commits were pushed since this workspace was checked out/)
  assert.ok(page.includes('| Linear ticket | [OEO-9](https://linear.app/acme/issue/OEO-9/login) |'), page)
  await worker.deactivate()
})

test('the page is a snapshot: opening it again neither rebuilds it nor duplicates the exclude line', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WORKTREE, references: [MR_URL] })
  fakes.files.write(EXCLUDE, '# exclude patterns\n*.swp')
  const { host, worker } = await startWorker(fakes)

  await worker.request('rr.startReview', { url: MR_URL, withAgent: false })
  fakes.gitlab.push('acme/api', 7)
  await worker.request('rr.openCoverPage', { url: MR_URL })

  assert.equal(fakes.files.writes.filter((path) => path === PAGE).length, 1)
  assert.equal(fakes.files.peek(EXCLUDE), '# exclude patterns\n*.swp\n.orca-review/\n')
  assert.equal(host.callsOf('editor.open').length, 2)
  await worker.deactivate()
})

test('Open workspace builds and opens a missing cover page, and leaves an existing one alone', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WORKTREE, references: [MR_URL] })
  const { host, worker } = await startWorker(fakes)

  await worker.request('rr.openWorkspace', { url: MR_URL })
  assert.match(fakes.files.peek(PAGE) ?? '', /^# Add login\n/)
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: '.orca-review/merge-request.md' }])

  await worker.request('rr.openWorkspace', { url: MR_URL })
  assert.equal(fakes.files.writes.filter((path) => path === PAGE).length, 1)
  assert.equal(host.callsOf('editor.open').length, 1)
  assert.equal(host.callsOf('workspace.open').length, 2)
  await worker.deactivate()
})

test("the Review Draft's Cover page also opens an Ended Review Request's page, building it if missing", async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WORKTREE, references: [MR_URL] })
  const { host, worker } = await startWorker(fakes)
  fakes.gitlab.approve('acme/api', 7)
  await worker.request('rr.refresh')
  assert.equal((await worker.request('rr.snapshot')).ended?.[0]?.url, MR_URL)

  assert.deepEqual(await worker.request('rr.openCoverPage', { url: MR_URL }), { opened: true })

  assert.match(fakes.files.peek(PAGE) ?? '', /^# Add login\n/)
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: '.orca-review/merge-request.md' }])
  await worker.deactivate()
})

test("Open workspace on an Ended Review Request builds its missing page too", async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WORKTREE, references: [MR_URL] })
  const { host, worker } = await startWorker(fakes)
  fakes.gitlab.approve('acme/api', 7)
  await worker.request('rr.refresh')

  await worker.request('rr.openWorkspace', { url: MR_URL })

  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'ws-1' }])
  assert.match(fakes.files.peek(PAGE) ?? '', /^# Add login\n/)
  assert.equal(host.callsOf('editor.open').length, 1)
  await worker.deactivate()
})

test("when GitLab can't give the page, the Agent Review still starts and Start review says what failed", async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes)
  fakes.gitlab.failNext(new GitLabError('rejected', '404 Not Found', { status: 404 }))

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: true }), (error) =>
    /Review Workspace is ready, but the Review Cover Page didn't open: .*404/.test(String(error))
  )
  assert.equal(host.callsOf('agent.launch').length, 1)
  assert.equal(fakes.files.peek(PAGE), null)
  assert.equal(host.callsOf('editor.open').length, 0)
  await worker.deactivate()
})

test('the changed-file list has every file of a merge request larger than one page of diffs', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  const files = Array.from({ length: 230 }, (_, i) => ({ old_path: `f${i}.ts`, new_path: `f${i}.ts`, diff: '@@ -1 +1 @@\n+x\n' }))
  fakes.gitlab.setDiffs('acme/api', 7, files)
  fakes.cli.addRepo(REPO)
  const { worker } = await startWorker(fakes)

  await worker.request('rr.startReview', { url: MR_URL, withAgent: false })

  const page = fakes.files.peek(PAGE) ?? ''
  assert.match(page, /## Changed files \(230\)/)
  assert.match(page, /\| `f229\.ts` \| modified \| \+1 \| -0 \|/)
  await worker.deactivate()
})
