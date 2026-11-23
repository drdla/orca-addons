// The unposted Review Comments hook (#14, #30) at the Ended module's seam: manual removal asks
// first (without forcing), auto-removal skips and retries. The worker wires the hook in #30.
import { assert, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { FakeClock, FakeGit, FakeOrcaCli } from '../fakes'
import { createWorkspaceTracker } from '../workspaces/workspace-tracker'
import { createEndedWorkspaces } from './ended-workspaces'

const DAY = 24 * 60 * 60_000
const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'

async function arrange(unposted: () => number) {
  const clock = new FakeClock()
  const cli = new FakeOrcaCli()
  cli.addWorktree({ name: 'review-api-7', path: '/wt/review-api-7', references: [MR_URL] })
  const workspaces = createWorkspaceTracker(() => cli, () => {})
  await workspaces.refresh()
  const stored: Record<string, unknown> = {}
  const host = {
    call: async () => ({ workspaces: [], truncated: false })
  } as unknown as OrcaWorkerApi['host']
  const ended = createEndedWorkspaces({
    storage: { get: async (k) => stored[k] ?? null, set: async (k, v) => void (stored[k] = v) },
    cli: () => cli,
    git: new FakeGit(),
    host,
    clock,
    workspaces,
    autoRemoveDays: async () => 2,
    unpostedReviewComments: async () => unposted(),
    log: () => {}
  })
  await ended.load()
  const view = { url: MR_URL, title: 'Add login', projectPath: 'acme/api', iid: 7, author: 'ada', requestedAt: 0 }
  await ended.onDropped([{ ...view, reason: 'merged' }], clock.now())
  return { clock, cli, ended }
}

const removals = (cli: FakeOrcaCli) => cli.calls.filter((c) => c.command === 'worktree rm')

test('unposted Review Comments make auto-removal skip until they are posted', async () => {
  let unposted = 1
  const { clock, cli, ended } = await arrange(() => unposted)
  await clock.advance(2 * DAY)

  await ended.tick()
  assert.equal(removals(cli).length, 0)
  assert.equal(ended.entries()[0]?.autoRemoveSkipped, 'Not removed automatically: 1 unposted Review Comment.')

  unposted = 0
  await ended.tick()
  assert.equal(removals(cli).length, 1)
  assert.deepEqual(ended.entries(), [])
})
