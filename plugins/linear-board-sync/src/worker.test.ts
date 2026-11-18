// The worker over a fake orca CLI and a fake clock: which cards move, what the status bar says,
// and how it reacts to Orca's workspace events and the commands.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { FakeClock } from './fakes/fake-clock'
import { FakeOrcaCli } from './fakes/fake-orca-cli'
import { createWorker, PAUSE_COMMAND, SYNC_NOW_COMMAND } from './worker'

const MINUTE = 60_000
/** Settings as real Orca hands them over: with the declared defaults filled in. */
const CONFIGURED = { teams: '', pollMinutes: 2, stateMapping: '{}' }

type StatusBarUpdate = { id: string; text?: string; icon?: string; tone?: string; tooltip?: string; visible?: boolean }

async function start(arrange: (cli: FakeOrcaCli) => void, settings: Record<string, string | number> = CONFIGURED) {
  const cli = new FakeOrcaCli()
  const clock = new FakeClock()
  arrange(cli)
  const host = mockHost({ settings })
  const worker = await mountWorker(createWorker({ cli, clock }), { host })
  await clock.advance(0)
  const statusBar = () => host.callsOf('statusBar.update').at(-1) as StatusBarUpdate | undefined
  return { cli, clock, host, worker, statusBar }
}

test("on start, each Linked Workspace's card moves to the column its ticket maps to; other cards stay", async () => {
  const { cli, statusBar } = await start((cli) => {
    cli.addCard({ name: 'linked', column: 'in-progress', linkedIssue: 'OEO-1' })
    cli.addCard({ name: 'oeo-2-by-branch', column: 'todo' })
    cli.addCard({ name: 'adhoc', column: 'in-review' })
    cli.setTicket('OEO-1', 'Done', 'completed')
    cli.setTicket('OEO-2', 'In Progress', 'started')
  })

  assert.deepEqual(cli.moves(), ['linked → completed', 'oeo-2-by-branch → in-progress'])
  assert.equal(cli.columnOf('adhoc'), 'in-review')
  assert.equal(statusBar()?.tone, 'neutral')
  assert.match(statusBar()?.tooltip ?? '', /in step with Linear/)
})

test('a Linear change reaches the board at the next poll, two minutes later', async () => {
  const { cli, clock } = await start((cli) => {
    cli.addCard({ name: 'linked', column: 'todo', linkedIssue: 'OEO-1' })
    cli.setTicket('OEO-1', 'Todo', 'unstarted')
  })
  cli.setTicket('OEO-1', 'In Progress', 'started')

  await clock.advance(1 * MINUTE)
  assert.equal(cli.columnOf('linked'), 'todo')
  await clock.advance(1 * MINUTE)
  assert.equal(cli.columnOf('linked'), 'in-progress')
})

test('the State Mapping overrides from the settings apply', async () => {
  const { cli } = await start(
    (cli) => {
      cli.addCard({ name: 'linked', column: 'in-progress', linkedIssue: 'OEO-1' })
      cli.setTicket('OEO-1', 'Review', 'started')
    },
    { ...CONFIGURED, stateMapping: '{"OEO/Review": "in-review"}' }
  )
  assert.equal(cli.columnOf('linked'), 'in-review')
})

test('a failed card move is skipped and shown as a status-bar warning; other cards still sync, with no retry before the next poll', async () => {
  const { cli, clock, worker, statusBar } = await start(
    (cli) => {
      cli.addCard({ name: 'blocked', column: 'in-progress', linkedIssue: 'OEO-1' })
      cli.addCard({ name: 'done', column: 'in-progress', linkedIssue: 'OEO-2' })
      cli.setTicket('OEO-1', 'Blocked', 'started')
      cli.setTicket('OEO-2', 'Done', 'completed')
    },
    { ...CONFIGURED, stateMapping: '{"Blocked": "blocked"}' }
  )

  assert.deepEqual(cli.moves(), ['blocked → blocked', 'done → completed'])
  assert.equal(cli.columnOf('done'), 'completed')
  assert.equal(statusBar()?.tone, 'warning')
  assert.match(statusBar()?.tooltip ?? '', /OEO-1.*blocked/)
  assert.ok(worker.logs.some((line) => /OEO-1.*blocked/.test(line)))

  await clock.advance(1 * MINUTE)
  assert.equal(cli.moves().length, 2)
  await clock.advance(1 * MINUTE)
  assert.deepEqual(cli.moves().slice(2), ['blocked → blocked'])
})

test("when Linear or the board can't be read, the status bar warns and no card moves", async () => {
  const { cli, statusBar } = await start((cli) => {
    cli.addCard({ name: 'linked', column: 'todo', linkedIssue: 'OEO-1' })
    cli.setTicket('OEO-1', 'Done', 'completed')
    cli.fail('linearTeams')
  })
  assert.deepEqual(cli.moves(), [])
  assert.equal(statusBar()?.tone, 'warning')
  assert.match(statusBar()?.tooltip ?? '', /linearTeams failed/)
})

test("a ticket that can't be read is a warning; the other cards still sync", async () => {
  const { cli, statusBar } = await start((cli) => {
    cli.addCard({ name: 'missing', column: 'todo', linkedIssue: 'OEO-404' })
    cli.addCard({ name: 'linked', column: 'todo', linkedIssue: 'OEO-1' })
    cli.setTicket('OEO-1', 'Done', 'completed')
  })
  assert.deepEqual(cli.moves(), ['linked → completed'])
  assert.match(statusBar()?.tooltip ?? '', /OEO-404/)
})

test("a newly created workspace's card is placed on workspace.created, not at the next poll", async () => {
  const { cli, worker } = await start(() => {})
  const card = cli.addCard({ name: 'oeo-7-new-thing', column: 'todo' })
  cli.setTicket('OEO-7', 'In Progress', 'started')
  const before = cli.calls.length

  await worker.emit('workspace.created', { workspaceId: 'ws-7', kind: 'worktree', path: card.path, branch: 'oeo-7-new-thing' })

  assert.equal(cli.columnOf('oeo-7-new-thing'), 'in-progress')
  assert.deepEqual(
    cli.calls.slice(before).filter((c) => c.startsWith('ticket')),
    ['ticket OEO-7'],
    'reads only the new workspace’s ticket'
  )
})

test('the memory of each Linked Workspace is kept in plugin storage, and workspace.removed deletes it', async () => {
  const { cli, host, worker } = await start((cli) => {
    cli.addCard({ name: 'a', column: 'todo', linkedIssue: 'OEO-1' })
    cli.addCard({ name: 'b', column: 'todo', linkedIssue: 'OEO-2' })
    cli.setTicket('OEO-1', 'Review', 'started')
    cli.setTicket('OEO-2', 'Todo', 'unstarted')
  })
  const remembered = () => Object.keys((host.data().storage.memory ?? {}) as object).sort()
  assert.deepEqual(remembered(), ['/worktrees/a', '/worktrees/b'])

  cli.removeCard('a')
  await worker.emit('workspace.removed', { workspaceId: 'ws-a', kind: 'worktree', path: '/worktrees/a' })

  assert.deepEqual(remembered(), ['/worktrees/b'])
})

test('without settings, as under `orca plugin check`, the worker never calls the orca CLI', async () => {
  const { cli, clock } = await start((cli) => cli.addCard({ name: 'oeo-1-x' }), {})
  await clock.advance(10 * MINUTE)
  assert.deepEqual(cli.calls, [])
})

test('Sync now syncs at once and says what it did', async () => {
  const { cli, worker } = await start((cli) => {
    cli.addCard({ name: 'linked', column: 'todo', linkedIssue: 'OEO-1' })
    cli.setTicket('OEO-1', 'Todo', 'unstarted')
  })
  cli.setTicket('OEO-1', 'Done', 'completed')

  const said = await worker.command(SYNC_NOW_COMMAND)

  assert.equal(cli.columnOf('linked'), 'completed')
  assert.match(String(said), /1 card moved/)
})

test('Pause stops syncing and says so in the status bar; running it again resumes and syncs at once', async () => {
  const { cli, clock, worker, statusBar } = await start((cli) => {
    cli.addCard({ name: 'linked', column: 'todo', linkedIssue: 'OEO-1' })
    cli.setTicket('OEO-1', 'Todo', 'unstarted')
  })

  await worker.command(PAUSE_COMMAND)
  cli.setTicket('OEO-1', 'Done', 'completed')
  await clock.advance(10 * MINUTE)
  assert.equal(cli.columnOf('linked'), 'todo')
  assert.match(statusBar()?.text ?? '', /paused/i)

  await worker.command(PAUSE_COMMAND)
  assert.equal(cli.columnOf('linked'), 'completed')
  assert.ok(!/paused/i.test(statusBar()?.text ?? ''))
})

test('the poll interval comes from the settings', async () => {
  const { cli, clock } = await start(
    (cli) => {
      cli.addCard({ name: 'linked', column: 'todo', linkedIssue: 'OEO-1' })
      cli.setTicket('OEO-1', 'Todo', 'unstarted')
    },
    { ...CONFIGURED, pollMinutes: 5 }
  )
  cli.setTicket('OEO-1', 'Done', 'completed')

  await clock.advance(4 * MINUTE)
  assert.equal(cli.columnOf('linked'), 'todo')
  await clock.advance(1 * MINUTE)
  assert.equal(cli.columnOf('linked'), 'completed')
})

test("syncing a newly created workspace keeps the last poll's warnings in the status bar", async () => {
  const { cli, worker, statusBar } = await start(
    (cli) => {
      cli.addCard({ name: 'blocked', column: 'in-progress', linkedIssue: 'OEO-1' })
      cli.setTicket('OEO-1', 'Blocked', 'started')
    },
    { ...CONFIGURED, stateMapping: '{"Blocked": "blocked"}' }
  )
  const card = cli.addCard({ name: 'oeo-7-new', column: 'todo' })
  cli.setTicket('OEO-7', 'Todo', 'unstarted')

  await worker.emit('workspace.created', { workspaceId: 'ws-7', kind: 'worktree', path: card.path, branch: 'oeo-7-new' })

  assert.match(statusBar()?.tooltip ?? '', /OEO-1.*blocked/)
})

async function create(worker: Awaited<ReturnType<typeof start>>['worker'], cli: FakeOrcaCli, name: string) {
  const card = cli.addCard({ name, column: 'todo' })
  await worker.emit('workspace.created', { workspaceId: `ws-${name}`, kind: 'worktree', path: card.path, branch: name })
}

test('creating a workspace for my Todo ticket Starts it: In Progress in Linear, and its card in In Progress', async () => {
  const { cli, worker } = await start(() => {})
  cli.setTicket('OEO-7', 'Todo', 'unstarted', 'me')

  await create(worker, cli, 'oeo-7-new-thing')

  assert.deepEqual(cli.writes(), ['setState OEO-7 → In Progress'])
  assert.equal(cli.ticketOf('OEO-7')?.stateName, 'In Progress')
  assert.equal(cli.columnOf('oeo-7-new-thing'), 'in-progress')
})

test('creating a workspace for an unassigned ticket also assigns it to me, before setting In Progress', async () => {
  const { cli, worker } = await start(() => {})
  cli.setTicket('OEO-7', 'Backlog', 'backlog', null)

  await create(worker, cli, 'oeo-7-new-thing')

  assert.deepEqual(cli.writes(), ['assignToMe OEO-7', 'setState OEO-7 → In Progress'])
  assert.equal(cli.ticketOf('OEO-7')?.assignee, 'me')
})

test("creating a workspace for a colleague's ticket writes nothing to Linear; its card still syncs one way", async () => {
  const { cli, worker } = await start(() => {})
  cli.setTicket('OEO-7', 'Review', 'started', 'colleague')
  cli.setTicket('OEO-8', 'Todo', 'unstarted', 'colleague')

  await create(worker, cli, 'oeo-7-review')
  await create(worker, cli, 'oeo-8-todo')

  assert.deepEqual(cli.writes(), [])
  assert.equal(cli.columnOf('oeo-7-review'), 'in-progress')
  assert.equal(cli.columnOf('oeo-8-todo'), 'todo')
})

test('after a Start, the next Linear poll sees In Progress and writes nothing more (no echo)', async () => {
  const { cli, clock, worker } = await start(() => {})
  cli.setTicket('OEO-7', 'Todo', 'unstarted', null)
  await create(worker, cli, 'oeo-7-new-thing')
  const writes = cli.writes().length
  const moves = cli.moves().length

  await clock.advance(2 * MINUTE)

  assert.equal(cli.writes().length, writes)
  assert.equal(cli.moves().length, moves)
  assert.equal(cli.columnOf('oeo-7-new-thing'), 'in-progress')
})

test('a failed Linear write is a status-bar warning, its card is not moved, and it is not retried', async () => {
  const { cli, clock, worker, statusBar } = await start(() => {})
  cli.setTicket('OEO-7', 'Todo', 'unstarted', null)
  cli.fail('assignToMe')

  await create(worker, cli, 'oeo-7-new-thing')

  assert.deepEqual(cli.writes(), ['assignToMe OEO-7'], 'In Progress is not set once the assignment failed')
  assert.equal(cli.columnOf('oeo-7-new-thing'), 'todo')
  assert.equal(statusBar()?.tone, 'warning')
  assert.match(statusBar()?.tooltip ?? '', /OEO-7.*couldn't assign it to you in Linear/)
  assert.ok(worker.logs.some((line) => /OEO-7.*couldn't assign it to you in Linear/.test(line)))

  await clock.advance(10 * MINUTE)
  assert.deepEqual(cli.writes(), ['assignToMe OEO-7'])
  assert.equal(cli.columnOf('oeo-7-new-thing'), 'todo')
})

test('a poll never Starts a ticket; only creating its workspace does', async () => {
  const { cli, clock } = await start((cli) => {
    cli.addCard({ name: 'oeo-7-old', column: 'todo' })
    cli.setTicket('OEO-7', 'Todo', 'unstarted', 'me')
  })
  await clock.advance(10 * MINUTE)
  assert.deepEqual(cli.writes(), [])
})

const SECOND = 1_000

async function startWithMyTicket(stateName = 'Todo', stateType = 'unstarted', column = 'todo') {
  const started = await start((cli) => {
    cli.addCard({ name: 'mine', column, linkedIssue: 'OEO-1' })
    cli.addCard({ name: 'other', column: 'todo', linkedIssue: 'OEO-2' })
    cli.setTicket('OEO-1', stateName, stateType, 'me')
    cli.setTicket('OEO-2', 'Todo', 'unstarted', 'me')
  })
  started.cli.calls.length = 0
  return started
}

test('a drag into a Writable Column is written to Linear at the next board check, 15 s later, reading only that ticket', async () => {
  const { cli, clock } = await startWithMyTicket()
  cli.drag('mine', 'in-progress')

  await clock.advance(14 * SECOND)
  assert.deepEqual(cli.writes(), [])
  await clock.advance(1 * SECOND)

  assert.deepEqual(cli.writes(), ['setState OEO-1 → In Progress'])
  assert.equal(cli.ticketOf('OEO-1')?.stateName, 'In Progress')
  assert.equal(cli.columnOf('mine'), 'in-progress')
  assert.deepEqual(cli.calls.filter((c) => c.startsWith('ticket')), ['ticket OEO-1'])
})

test('board checks without a drag read no ticket; the Linear poll stays on its own interval', async () => {
  const { cli, clock } = await startWithMyTicket()
  await clock.advance(2 * MINUTE - SECOND)
  assert.ok(cli.calls.filter((c) => c === 'board').length >= 7, 'the board is checked every 15 s')
  assert.deepEqual(cli.calls.filter((c) => c.startsWith('ticket')), [])
  await clock.advance(SECOND)
  assert.deepEqual(cli.calls.filter((c) => c.startsWith('ticket')), ['ticket OEO-1', 'ticket OEO-2'])
})

test('after a drag is written back, later checks and polls write and move nothing (no echo)', async () => {
  const { cli, clock } = await startWithMyTicket()
  cli.drag('mine', 'in-progress')
  await clock.advance(15 * SECOND)
  await clock.advance(5 * MINUTE)
  assert.deepEqual(cli.writes(), ['setState OEO-1 → In Progress'])
  assert.deepEqual(cli.moves(), [])
})

test('a drag into a column GitLab or the PO own is moved back, with a status-bar message', async () => {
  const { cli, clock, statusBar } = await startWithMyTicket('In Progress', 'started', 'in-progress')
  cli.drag('mine', 'completed')

  await clock.advance(15 * SECOND)

  assert.deepEqual(cli.writes(), [])
  assert.equal(cli.columnOf('mine'), 'in-progress')
  assert.match(statusBar()?.tooltip ?? '', /OEO-1.*GitLab or the PO/)
})

test("a drag of a colleague's card is moved back", async () => {
  const { cli, clock, statusBar } = await start((cli) => {
    cli.addCard({ name: 'theirs', column: 'todo', linkedIssue: 'OEO-1' })
    cli.setTicket('OEO-1', 'Todo', 'unstarted', 'colleague')
  })
  cli.drag('theirs', 'in-progress')
  await clock.advance(15 * SECOND)
  assert.deepEqual(cli.writes(), [])
  assert.equal(cli.columnOf('theirs'), 'todo')
  assert.match(statusBar()?.tooltip ?? '', /OEO-1.*someone else/)
})

test('conflict: Linear changed and the card was dragged since the last check, so Linear wins', async () => {
  const { cli, clock, statusBar } = await startWithMyTicket()
  cli.setTicket('OEO-1', 'Done', 'completed')
  cli.drag('mine', 'in-progress')
  await clock.advance(15 * SECOND)
  assert.deepEqual(cli.writes(), [])
  assert.equal(cli.columnOf('mine'), 'completed')
  assert.match(statusBar()?.tooltip ?? '', /OEO-1.*Linear wins/)
})

test('a failed drag write is a warning and is not retried every board check; the next Linear poll applies Linear', async () => {
  const { cli, clock, statusBar } = await startWithMyTicket()
  cli.fail('setState')
  cli.drag('mine', 'in-progress')

  await clock.advance(15 * SECOND)
  assert.match(statusBar()?.tooltip ?? '', /OEO-1.*couldn't set it to "In Progress"/)
  await clock.advance(MINUTE)
  assert.equal(cli.writes().length, 1)

  await clock.advance(MINUTE)
  assert.equal(cli.writes().length, 1)
  assert.equal(cli.columnOf('mine'), 'todo')
})

test('Pause stops the board check too; resuming discards drags made while paused and re-applies Linear', async () => {
  const { cli, clock, worker } = await startWithMyTicket()
  await worker.command(PAUSE_COMMAND)
  cli.drag('mine', 'in-progress')
  await clock.advance(5 * MINUTE)
  assert.equal(cli.columnOf('mine'), 'in-progress')

  await worker.command(PAUSE_COMMAND)
  await clock.advance(MINUTE)

  assert.deepEqual(cli.writes(), [])
  assert.equal(cli.columnOf('mine'), 'todo')
})

test('Sync now also writes back a drag at once', async () => {
  const { cli, worker } = await startWithMyTicket()
  cli.drag('mine', 'in-progress')
  await worker.command(SYNC_NOW_COMMAND)
  assert.deepEqual(cli.writes(), ['setState OEO-1 → In Progress'])
})
