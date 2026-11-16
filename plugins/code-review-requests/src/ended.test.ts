// The Ended tab and Review Workspace removal end to end through the worker (#28, decided in #7):
// which Ended Review Requests are listed, manual removal with its checks and confirmation, and
// auto-removal. GitLab, the orca CLI, git and the clock are fakes; Orca's host is the kit's mock.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import { createWorker } from './worker'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const CONFIGURED = { instanceUrl: 'https://gitlab.example.com', pollMinutes: 5 }
const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const REPO = { repoId: 'repo-api', projectId: 'git:gitlab.example.com/acme/api', path: '/src/api' }
const WT_PATH = '/wt/review-api-7'
const WT_ID = `${REPO.repoId}::${WT_PATH}`

type WorkspaceStatus = { state: 'working' | 'permission' | 'done' | 'active' | 'inactive'; terminalCount: number }

/** `workspace.list` as Orca answers it: the review workspace with the given live status. */
function hostWith(status: () => WorkspaceStatus, settings: Record<string, string | number> = {}, storage = {}) {
  return mockHost({
    settings: { ...CONFIGURED, ...settings },
    storage,
    results: {
      'workspace.list': () => ({
        workspaces: [
          {
            id: 'ws-review',
            kind: 'worktree',
            name: 'review-api-7',
            path: WT_PATH,
            branch: null,
            hostId: 'local',
            status: { ...status(), unread: false, lastActivityAt: 0 }
          }
        ],
        truncated: false
      }),
      'workspace.open': { opened: true }
    }
  })
}

const idle = (): WorkspaceStatus => ({ state: 'inactive', terminalCount: 0 })

async function start(fakes: Fakes, host = hostWith(idle)) {
  const worker = await mountWorker(createWorker(fakes.deps), { host })
  await fakes.clock.advance(0)
  return { host, worker }
}

/** A Review Request !7 with a Review Workspace, and !8 without one. */
function arrange(fakes: Fakes) {
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, title: 'Add login', author: 'ada' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 8, title: 'Fix typo', author: 'bob' })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: WT_PATH, references: [MR_URL] })
}

function removals(fakes: Fakes) {
  return fakes.cli.calls.filter((c) => c.command === 'worktree rm').map((c) => c.args)
}

test('an Ended Review Request with a Review Workspace is listed under Ended, with its reason', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const { worker } = await start(fakes)

  fakes.gitlab.approve('acme/api', 7)
  fakes.gitlab.approve('acme/api', 8)
  await fakes.clock.advance(5 * MINUTE)

  const snapshot = await worker.request('rr.snapshot')
  assert.deepEqual(
    snapshot.ended?.map((e) => [e.iid, e.reason, e.workspace.id]),
    [[7, 'approved', WT_ID]],
    'only the one with a Review Workspace; !8 only notifies'
  )
  assert.equal(snapshot.reviewRequests.length, 0)
  await worker.deactivate()
})

/** Starts with !7 (which has a Review Workspace) already Ended by approval. */
async function startEnded(fakes: Fakes, host = hostWith(idle)) {
  arrange(fakes)
  const started = await start(fakes, host)
  fakes.gitlab.approve('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  return started
}

test('a Review Request made draft is not Ended', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const { worker } = await start(fakes)

  fakes.gitlab.markDraft('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)

  assert.equal((await worker.request('rr.snapshot')).ended, undefined)
  await worker.deactivate()
})

test('merged, closed and reviewer-removed Review Requests are Ended too, most recent first', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 9 })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 10 })
  for (const iid of [9, 10]) {
    fakes.cli.addWorktree({
      name: `review-api-${iid}`,
      repoId: REPO.repoId,
      path: `/wt/review-api-${iid}`,
      references: [`https://gitlab.example.com/acme/api/-/merge_requests/${iid}`]
    })
  }
  const { worker } = await start(fakes)

  fakes.gitlab.merge('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  fakes.gitlab.close('acme/api', 9)
  await fakes.clock.advance(5 * MINUTE)
  fakes.gitlab.removeReviewer('acme/api', 10)
  await fakes.clock.advance(5 * MINUTE)

  const ended = (await worker.request('rr.snapshot')).ended ?? []
  assert.deepEqual(
    ended.map((e) => [e.iid, e.reason]),
    [
      [10, 'unassigned'],
      [9, 'closed'],
      [7, 'merged']
    ]
  )
  await worker.deactivate()
})

test('an Ended Review Request that becomes a Review Request again leaves Ended', async () => {
  const fakes = fakeDeps()
  arrange(fakes)
  const { worker } = await start(fakes)
  fakes.gitlab.removeReviewer('acme/api', 7)
  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual((await worker.request('rr.snapshot')).ended?.map((e) => e.reason), ['unassigned'])

  fakes.gitlab.addReviewer('acme/api', 7)
  await fakes.clock.advance(2 * DAY)

  const snapshot = await worker.request('rr.snapshot')
  assert.ok(snapshot.reviewRequests.some((r) => r.iid === 7))
  assert.equal(snapshot.ended, undefined)
  assert.deepEqual(removals(fakes), [], 'its auto-removal is cancelled')
  await worker.deactivate()
})

test('Ended entries are kept across restarts', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startEnded(fakes)
  await worker.deactivate()

  const restarted = await start(fakes, hostWith(idle, {}, host.data().storage))
  assert.deepEqual(
    (await restarted.worker.request('rr.snapshot')).ended?.map((e) => e.iid),
    [7]
  )
  await restarted.worker.deactivate()
})

test('an entry goes when Orca reports its workspace removed, and open panels hear of it', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)
  await fakes.cli.removeWorktree(`id:${WT_ID}`)

  await worker.emit('workspace.removed', { workspaceId: 'ws-review', kind: 'worktree', path: WT_PATH })

  assert.equal((await worker.request('rr.snapshot')).ended, undefined)
  const last = worker.posts.filter((p) => p.event === 'rr.changed').at(-1)
  assert.equal((last?.payload as { ended?: unknown }).ended, undefined)
  await worker.deactivate()
})

test('an entry goes when its workspace is no longer listed (deleted outside Orca)', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)

  await fakes.cli.removeWorktree(`id:${WT_ID}`)
  await fakes.clock.advance(5 * MINUTE)

  assert.equal((await worker.request('rr.snapshot')).ended, undefined)
  await worker.deactivate()
})

test('checking a clean workspace finds nothing to lose', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)

  assert.deepEqual(await worker.request('rr.checkRemoval', { url: MR_URL }), { problems: [], force: false })
  await worker.deactivate()
})

test('the check lists uncommitted changes and open terminals, and asks for force', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes, hostWith(() => ({ state: 'active', terminalCount: 2 })))
  fakes.git.setStatus(WT_PATH, [' M src/login.ts', '?? notes.md'])

  assert.deepEqual(await worker.request('rr.checkRemoval', { url: MR_URL }), {
    problems: ['2 uncommitted changes', '2 open terminals'],
    force: true
  })
  await worker.deactivate()
})

test('the check says when an agent is running', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes, hostWith(() => ({ state: 'working', terminalCount: 1 })))

  assert.deepEqual(await worker.request('rr.checkRemoval', { url: MR_URL }), {
    problems: ['an agent is running'],
    force: true
  })
  await worker.deactivate()
})

test('removing a clean workspace deletes it (and its merged branch) without force', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)

  const snapshot = await worker.request('rr.removeWorkspace', { url: MR_URL, force: false })

  assert.deepEqual(removals(fakes), [{ selector: `id:${WT_ID}`, deleteBranch: true }])
  assert.equal(snapshot.ended, undefined)
  await worker.deactivate()
})

test('Remove anyway forces the removal of a dirty workspace', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)
  fakes.cli.setDirty(WT_ID)

  await worker.request('rr.removeWorkspace', { url: MR_URL, force: true })

  assert.deepEqual(removals(fakes), [{ selector: `id:${WT_ID}`, deleteBranch: true, force: true }])
  assert.equal((await worker.request('rr.snapshot')).ended, undefined)
  await worker.deactivate()
})

test("a failed removal answers Orca's error and keeps the entry", async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)
  fakes.cli.setDirty(WT_ID)

  await assert.rejects(worker.request('rr.removeWorkspace', { url: MR_URL, force: false }), /uncommitted changes/)
  assert.deepEqual((await worker.request('rr.snapshot')).ended?.map((e) => e.iid), [7])
  await worker.deactivate()
})

test("Open workspace opens an Ended Review Request's workspace", async () => {
  const fakes = fakeDeps()
  const { host, worker } = await startEnded(fakes)

  await worker.request('rr.openWorkspace', { url: MR_URL })

  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'ws-review' }])
  await worker.deactivate()
})

test('auto-removal removes a clean workspace on the first tick 2 days after it ended, never forced', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)

  await fakes.clock.advance(2 * DAY - 10 * MINUTE)
  assert.deepEqual(removals(fakes), [], 'not before the deadline')

  await fakes.clock.advance(10 * MINUTE)
  assert.deepEqual(removals(fakes), [{ selector: `id:${WT_ID}`, deleteBranch: true }])
  assert.equal((await worker.request('rr.snapshot')).ended, undefined)
  await worker.deactivate()
})

test('auto-removal skips an unclean workspace, says why, and retries on later ticks', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)
  fakes.git.setStatus(WT_PATH, [' M src/login.ts'])

  await fakes.clock.advance(2 * DAY)
  assert.deepEqual(removals(fakes), [])
  assert.equal(
    (await worker.request('rr.snapshot')).ended?.[0]?.autoRemoveSkipped,
    'Not removed automatically: 1 uncommitted change.'
  )

  fakes.git.setStatus(WT_PATH, [])
  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(removals(fakes), [{ selector: `id:${WT_ID}`, deleteBranch: true }])
  await worker.deactivate()
})

test('auto-removal notes a refused removal and tries again later, never forced', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)
  fakes.cli.setDirty(WT_ID) // dirty as Orca sees it (an ignored file, say), clean to git status

  await fakes.clock.advance(2 * DAY)
  const entry = (await worker.request('rr.snapshot')).ended?.[0]
  assert.match(entry?.autoRemoveSkipped ?? '', /^Automatic removal failed: .*uncommitted changes/)
  const before = removals(fakes).length
  await fakes.clock.advance(5 * MINUTE)
  assert.equal(removals(fakes).length, before + 1, 'tried again')
  assert.ok(removals(fakes).every((args) => !(args as { force?: boolean }).force))
  await worker.deactivate()
})

test('auto-removal is off at 0 days', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes, hostWith(idle, { autoRemoveDays: 0 }))

  await fakes.clock.advance(10 * DAY)
  assert.deepEqual(removals(fakes), [])
  await worker.deactivate()
})

test('while the orca CLI is broken, Ended entries stay, auto-removal waits and the snapshot says why', async () => {
  const fakes = fakeDeps()
  const { worker } = await startEnded(fakes)
  const cli = fakes.cli
  const listWorktrees = cli.listWorktrees.bind(cli)
  let broken = true
  cli.listWorktrees = async () => {
    if (broken) throw new Error('Orca is not running')
    return listWorktrees()
  }

  await fakes.clock.advance(2 * DAY)
  const snapshot = await worker.request('rr.snapshot')
  assert.equal(snapshot.workspacesUnavailable, 'Orca is not running')
  assert.deepEqual(snapshot.ended?.map((e) => e.iid), [7])
  assert.deepEqual(removals(fakes), [])

  broken = false
  await fakes.clock.advance(5 * MINUTE)
  assert.deepEqual(removals(fakes), [{ selector: `id:${WT_ID}`, deleteBranch: true }])
  assert.equal((await worker.request('rr.snapshot')).workspacesUnavailable, undefined)
  await worker.deactivate()
})
