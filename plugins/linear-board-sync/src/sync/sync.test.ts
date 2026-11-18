// The sync rules, at their one seam: syncBoard() and ticketsToFetch(). Table cases over
// (Linear teams and tickets, the board, the memory, the settings) → (card moves, warnings, memory).
import { assert, test } from 'orca/testing'
import { parseSettings } from '../settings'
import { syncBoard, ticketsToFetch, type BoardCard, type LinearTeam, type Memory, type Ticket } from './sync'

const VESTIGAS = { workspaceId: 'ws-v', workspace: 'vestigas' }
const OTHER = { workspaceId: 'ws-o', workspace: 'other' }
const TEAMS: LinearTeam[] = [
  { key: 'OEO', ...VESTIGAS },
  { key: 'COR', ...VESTIGAS },
  { key: 'ENG', ...VESTIGAS },
  { key: 'ENG', ...OTHER }
]

function card(over: Partial<BoardCard> & { path: string }): BoardCard {
  return {
    worktreeId: `repo::${over.path}`,
    branch: null,
    column: 'in-progress',
    linkedIssue: null,
    linkedWorkspaceId: null,
    ...over
  }
}

function ticket(
  identifier: string,
  stateName: string,
  stateType: string,
  where = VESTIGAS,
  assignee: Ticket['assignee'] = 'me'
): Ticket {
  return { identifier, teamKey: identifier.split('-')[0]!, stateName, stateType, assignee, ...where }
}

function sync(input: {
  board: BoardCard[]
  tickets: Ticket[]
  memory?: Memory
  settings?: Record<string, unknown>
  created?: string
}) {
  return syncBoard({
    linear: { teams: TEAMS, tickets: input.tickets },
    board: input.board,
    memory: input.memory ?? {},
    settings: parseSettings(input.settings ?? {}).settings,
    created: input.created ?? null
  })
}

const movesOf = (result: ReturnType<typeof sync>) => result.moves.map((m) => `${m.path} → ${m.to}`)

const TYPE_CASES: [stateType: string, column: string][] = [
  ['triage', 'todo'],
  ['backlog', 'todo'],
  ['unstarted', 'todo'],
  ['started', 'in-progress'],
  ['completed', 'completed'],
  ['canceled', 'completed']
]

for (const [stateType, column] of TYPE_CASES) {
  test(`a ticket in a ${stateType} state moves its card to ${column} by default`, () => {
    const result = sync({
      board: [card({ path: '/w/a', column: 'in-review', linkedIssue: 'OEO-1' })],
      tickets: [ticket('OEO-1', 'Some state', stateType)]
    })
    assert.deepEqual(movesOf(result), [`/w/a → ${column}`])
  })
}

const OEO_OVERRIDES = JSON.stringify({ Blocked: 'blocked', Review: 'in-review', 'PO Acceptance': 'po-acceptance', Icebox: 'todo' })

const OVERRIDE_CASES: [title: string, stateMapping: string, ticket: Ticket, column: string][] = [
  ['a state-name override applies', OEO_OVERRIDES, ticket('OEO-1', 'Review', 'started'), 'in-review'],
  ['an override maps a custom column id', OEO_OVERRIDES, ticket('OEO-1', 'PO Acceptance', 'started'), 'po-acceptance'],
  ['state names match ignoring case and spaces around', '{" blocked ": "blocked"}', ticket('OEO-1', 'Blocked', 'started'), 'blocked'],
  ['a state not overridden maps by type', OEO_OVERRIDES, ticket('OEO-1', 'In Progress', 'started'), 'in-progress'],
  [
    'a team-scoped override beats an unscoped one',
    JSON.stringify({ Review: 'in-progress', 'OEO/Review': 'in-review' }),
    ticket('OEO-1', 'Review', 'started'),
    'in-review'
  ],
  [
    "another team's scoped override does not apply",
    JSON.stringify({ 'COR/Review': 'in-review' }),
    ticket('OEO-1', 'Review', 'started'),
    'in-progress'
  ]
]

for (const [title, stateMapping, theTicket, column] of OVERRIDE_CASES) {
  test(`State Mapping: ${title}`, () => {
    const result = sync({
      board: [card({ path: '/w/a', column: 'completed', linkedIssue: theTicket.identifier })],
      tickets: [theTicket],
      settings: { stateMapping }
    })
    assert.deepEqual(movesOf(result), [`/w/a → ${column}`])
  })
}

test('State Mapping overrides that are not a JSON object of column ids are reported and ignored', () => {
  for (const stateMapping of ['{nope', '["Review"]', '{"Review": 3}', '{"Review": ""}']) {
    const parsed = parseSettings({ stateMapping })
    assert.equal(parsed.problems.length, 1, stateMapping)
    assert.deepEqual(parsed.settings.overrides, [], stateMapping)
  }
})

const fetchFor = (board: BoardCard[], settings: Record<string, unknown> = {}) =>
  ticketsToFetch({ teams: TEAMS, board, settings: parseSettings(settings).settings })

test("a workspace is matched by Orca's Linear link first, then by an issue identifier in its branch", () => {
  const board = [
    card({ path: '/w/linked', branch: 'oeo-2-other-ticket', linkedIssue: 'OEO-1', linkedWorkspaceId: 'ws-v' }),
    card({ path: '/w/branch', branch: 'feature/OEO-3-add-thing' }),
    card({ path: '/w/lower', branch: 'cor-44-fix' })
  ]
  assert.deepEqual(fetchFor(board), [
    { identifier: 'OEO-1', workspaceId: 'ws-v' },
    { identifier: 'OEO-3', workspaceId: 'ws-v' },
    { identifier: 'COR-44', workspaceId: 'ws-v' }
  ])
})

test('a branch names a ticket only with a known team key and a whole number', () => {
  const board = [
    card({ path: '/w/a', branch: 'linter-errors-burndown-11-18' }),
    card({ path: '/w/b', branch: 'prototype/notification-ui' }),
    card({ path: '/w/c', branch: 'xoeo-12-thing' }),
    card({ path: '/w/d', branch: null })
  ]
  assert.deepEqual(fetchFor(board), [])
})

test('the same ticket on two workspaces is fetched once', () => {
  const board = [card({ path: '/w/a', branch: 'oeo-5-x' }), card({ path: '/w/b', linkedIssue: 'OEO-5' })]
  assert.deepEqual(fetchFor(board), [{ identifier: 'OEO-5', workspaceId: 'ws-v' }])
})

test('a branch key that exists in two Linear workspaces is ambiguous until the Teams setting names one', () => {
  const board = [card({ path: '/w/a', branch: 'eng-7-thing' })]
  assert.deepEqual(fetchFor(board), [])
  assert.deepEqual(fetchFor(board, { teams: 'other/ENG' }), [{ identifier: 'ENG-7', workspaceId: 'ws-o' }])

  const result = sync({ board, tickets: [] })
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0]!, /ENG.*several Linear workspaces/)
})

test('a branch-matched workspace syncs like a linked one', () => {
  const result = sync({
    board: [card({ path: '/w/a', branch: 'oeo-3-add-thing', column: 'todo' })],
    tickets: [ticket('OEO-3', 'In Progress', 'started')]
  })
  assert.deepEqual(movesOf(result), ['/w/a → in-progress'])
})

test('workspaces with no matching ticket are never touched or remembered', () => {
  const result = sync({
    board: [
      card({ path: '/w/plain', branch: 'main', column: 'blocked' }),
      card({ path: '/w/gone', linkedIssue: 'OEO-404', column: 'blocked' })
    ],
    tickets: []
  })
  assert.deepEqual(result.moves, [])
  assert.deepEqual(result.memory, {})
})

test('a card already in its mapped column does not move, and the memory records column and state', () => {
  const result = sync({
    board: [card({ path: '/w/a', linkedIssue: 'OEO-1', column: 'in-review' })],
    tickets: [ticket('OEO-1', 'Review', 'started')],
    settings: { stateMapping: OEO_OVERRIDES }
  })
  assert.deepEqual(result.moves, [])
  assert.deepEqual(result.memory, { '/w/a': { column: 'in-review', linearState: 'Review' } })
})

const TEAM_CASES: [title: string, teams: string, ticket: Ticket, moves: boolean][] = [
  ['an empty Teams setting syncs every team', '', ticket('COR-1', 'Done', 'completed'), true],
  ['a listed team syncs', 'OEO, cor', ticket('COR-1', 'Done', 'completed'), true],
  ['a team not listed is never touched', 'OEO', ticket('COR-1', 'Done', 'completed'), false],
  ['<workspace>/<key> syncs that workspace’s team', 'vestigas/COR', ticket('COR-1', 'Done', 'completed'), true],
  ['<workspace>/<key> leaves the same key in another workspace alone', 'other/COR', ticket('COR-1', 'Done', 'completed'), false]
]

for (const [title, teams, theTicket, moves] of TEAM_CASES) {
  test(`Teams: ${title}`, () => {
    const result = sync({
      board: [card({ path: '/w/a', column: 'in-progress', linkedIssue: theTicket.identifier })],
      tickets: [theTicket],
      settings: { teams }
    })
    assert.deepEqual(movesOf(result), moves ? ['/w/a → completed'] : [])
    assert.deepEqual(Object.keys(result.memory), moves ? ['/w/a'] : [])
  })
}

test('Teams entries that are not team keys are reported and skipped', () => {
  const parsed = parseSettings({ teams: 'OEO, a/b/c, /COR, nö' })
  assert.deepEqual(parsed.settings.teams, [{ key: 'OEO', workspace: null }])
  assert.equal(parsed.problems.length, 3)
})

test("a ticket whose state type has no default and no override is a warning, and its card stays", () => {
  const result = sync({
    board: [card({ path: '/w/a', linkedIssue: 'OEO-1', column: 'todo' })],
    tickets: [ticket('OEO-1', 'Weird', 'mystery')]
  })
  assert.deepEqual(result.moves, [])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0]!, /OEO-1.*Weird/)
})

test("the memory keeps a card's entry when its ticket could not be read, and drops workspaces no longer on the board", () => {
  const memory: Memory = {
    '/w/unread': { column: 'in-review', linearState: 'Review' },
    '/w/removed': { column: 'todo', linearState: 'Todo' }
  }
  const result = sync({
    board: [card({ path: '/w/unread', linkedIssue: 'OEO-1', column: 'in-review' })],
    tickets: [],
    memory
  })
  assert.deepEqual(result.memory, { '/w/unread': { column: 'in-review', linearState: 'Review' } })
})

const writesOf = (result: ReturnType<typeof sync>) =>
  result.writes.map((w) => (w.kind === 'set-state' ? `${w.ref.identifier} → ${w.state}` : `${w.ref.identifier} → assign me`))

const START_CASES: [title: string, ticket: Ticket, writes: string[]][] = [
  ['my Todo ticket is set to In Progress', ticket('OEO-1', 'Todo', 'unstarted'), ['OEO-1 → In Progress']],
  ['my Backlog ticket is set to In Progress', ticket('OEO-1', 'Backlog', 'backlog'), ['OEO-1 → In Progress']],
  ['my Triage ticket is set to In Progress', ticket('OEO-1', 'Triage', 'triage'), ['OEO-1 → In Progress']],
  [
    'an unassigned ticket is assigned to me, then set to In Progress',
    ticket('OEO-1', 'Todo', 'unstarted', VESTIGAS, null),
    ['OEO-1 → assign me', 'OEO-1 → In Progress']
  ],
  ["a colleague's ticket is never written", ticket('OEO-1', 'Todo', 'unstarted', VESTIGAS, 'colleague'), []],
  ['a started ticket is not written', ticket('OEO-1', 'Review', 'started'), []],
  ['a completed ticket is not written', ticket('OEO-1', 'Done', 'completed'), []],
  ['a canceled ticket is not written', ticket('OEO-1', 'Canceled', 'canceled'), []]
]

for (const [title, theTicket, writes] of START_CASES) {
  test(`Start, on creating a workspace: ${title}`, () => {
    const result = sync({
      board: [card({ path: '/w/new', column: 'todo', linkedIssue: 'OEO-1' })],
      tickets: [theTicket],
      created: '/w/new'
    })
    assert.deepEqual(writesOf(result), writes)
  })
}

test('a Start moves the new card to In Progress and remembers In Progress, so the next poll writes nothing', () => {
  const started = sync({
    board: [card({ path: '/w/new', column: 'todo', linkedIssue: 'OEO-1' })],
    tickets: [ticket('OEO-1', 'Todo', 'unstarted')],
    created: '/w/new'
  })
  assert.deepEqual(movesOf(started), ['/w/new → in-progress'])
  assert.deepEqual(started.memory, { '/w/new': { column: 'in-progress', linearState: 'In Progress' } })

  const nextPoll = sync({
    board: [card({ path: '/w/new', column: 'in-progress', linkedIssue: 'OEO-1' })],
    tickets: [ticket('OEO-1', 'In Progress', 'started')],
    memory: started.memory
  })
  assert.deepEqual(nextPoll.writes, [])
  assert.deepEqual(nextPoll.moves, [])
})

test("a Start's card lands where the State Mapping puts In Progress", () => {
  const result = sync({
    board: [card({ path: '/w/new', column: 'todo', linkedIssue: 'OEO-1' })],
    tickets: [ticket('OEO-1', 'Todo', 'unstarted')],
    settings: { stateMapping: '{"OEO/In Progress": "doing"}' },
    created: '/w/new'
  })
  assert.deepEqual(movesOf(result), ['/w/new → doing'])
})

test('a poll never Starts: only the workspace just created does', () => {
  const result = sync({
    board: [
      card({ path: '/w/old', column: 'todo', linkedIssue: 'OEO-1' }),
      card({ path: '/w/new', column: 'todo', linkedIssue: 'OEO-2' })
    ],
    tickets: [ticket('OEO-1', 'Todo', 'unstarted'), ticket('OEO-2', 'Todo', 'unstarted')],
    created: '/w/new'
  })
  assert.deepEqual(writesOf(result), ['OEO-2 → In Progress'])
  assert.deepEqual(writesOf(sync({ board: [card({ path: '/w/old', column: 'todo', linkedIssue: 'OEO-1' })], tickets: [ticket('OEO-1', 'Todo', 'unstarted')] })), [])
})

const DRAG_MAPPING = JSON.stringify({ Blocked: 'blocked', Review: 'in-review', 'PO Acceptance': 'po-acceptance' })

/** A card the plugin last put in `from` (Linear state `state`), now found in `to`. */
function drag(input: { from: string; to: string; state: string; ticket: Ticket }) {
  return sync({
    board: [card({ path: '/w/a', column: input.to, linkedIssue: input.ticket.identifier })],
    tickets: [input.ticket],
    memory: { '/w/a': { column: input.from, linearState: input.state } },
    settings: { stateMapping: DRAG_MAPPING }
  })
}

const WRITE_BACK_CASES: [title: string, from: string, to: string, ticket: Ticket, writes: string[]][] = [
  ['Todo → In Progress', 'todo', 'in-progress', ticket('OEO-1', 'Todo', 'unstarted'), ['OEO-1 → In Progress']],
  ['In Progress → Blocked', 'in-progress', 'blocked', ticket('OEO-1', 'In Progress', 'started'), ['OEO-1 → Blocked']],
  ['Blocked → In Progress', 'blocked', 'in-progress', ticket('OEO-1', 'Blocked', 'started'), ['OEO-1 → In Progress']],
  ['Review → In Progress', 'in-review', 'in-progress', ticket('OEO-1', 'Review', 'started'), ['OEO-1 → In Progress']],
  ['In Progress back to Todo', 'in-progress', 'todo', ticket('OEO-1', 'In Progress', 'started'), ['OEO-1 → Todo']],
  [
    'an unassigned ticket set to In Progress',
    'in-review',
    'in-progress',
    ticket('OEO-1', 'Review', 'started', VESTIGAS, null),
    ['OEO-1 → In Progress']
  ],
  [
    'an unassigned Todo ticket dragged to In Progress is a Start: assigned to me first',
    'todo',
    'in-progress',
    ticket('OEO-1', 'Todo', 'unstarted', VESTIGAS, null),
    ['OEO-1 → assign me', 'OEO-1 → In Progress']
  ],
  ['an unassigned ticket set back to Todo', 'in-progress', 'todo', ticket('OEO-1', 'In Progress', 'started', VESTIGAS, null), ['OEO-1 → Todo']]
]

for (const [title, from, to, theTicket, writes] of WRITE_BACK_CASES) {
  test(`a drag into a Writable Column sets the Linear state: ${title}`, () => {
    const state = theTicket.stateName
    const result = drag({ from, to, state, ticket: theTicket })
    assert.deepEqual(writesOf(result), writes)
    assert.deepEqual(result.moves, [], 'the card stays where it was dragged')
    assert.deepEqual(result.warnings, [])
    const written = writes.at(-1)!.split(' → ')[1]!
    assert.deepEqual(result.memory, { '/w/a': { column: to, linearState: written } }, 'no echo at the next check')
  })
}

const REVERT_CASES: [title: string, from: string, to: string, ticket: Ticket, message: RegExp][] = [
  ['a drag into In Review', 'in-progress', 'in-review', ticket('OEO-1', 'In Progress', 'started'), /OEO-1.*in-review.*GitLab or the PO/],
  ['a drag into PO Acceptance', 'in-review', 'po-acceptance', ticket('OEO-1', 'Review', 'started'), /OEO-1.*po-acceptance.*GitLab or the PO/],
  ['a drag into Done', 'in-review', 'completed', ticket('OEO-1', 'Review', 'started'), /OEO-1.*completed.*GitLab or the PO/],
  [
    "a drag of a colleague's card, even into a Writable Column",
    'todo',
    'in-progress',
    ticket('OEO-1', 'Todo', 'unstarted', VESTIGAS, 'colleague'),
    /OEO-1.*assigned to someone else/
  ],
  [
    "a drag of a colleague's card into a column GitLab or the PO own",
    'in-progress',
    'completed',
    ticket('OEO-1', 'In Progress', 'started', VESTIGAS, 'colleague'),
    /OEO-1.*assigned to someone else/
  ]
]

for (const [title, from, to, theTicket, message] of REVERT_CASES) {
  test(`a drag Linear does not take from the board is reverted with a message: ${title}`, () => {
    const result = drag({ from, to, state: theTicket.stateName, ticket: theTicket })
    assert.deepEqual(result.writes, [])
    assert.deepEqual(movesOf(result), [`/w/a → ${from}`])
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0]!, message)
    assert.deepEqual(result.memory, { '/w/a': { column: from, linearState: theTicket.stateName } })
  })
}

test('conflict: Linear changed since last seen, so Linear is applied and the drag discarded, with a message', () => {
  const result = drag({ from: 'in-progress', to: 'blocked', state: 'In Progress', ticket: ticket('OEO-1', 'Review', 'started') })
  assert.deepEqual(result.writes, [])
  assert.deepEqual(movesOf(result), ['/w/a → in-review'])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0]!, /OEO-1.*Linear.*"Review".*drag/)
  assert.deepEqual(result.memory, { '/w/a': { column: 'in-review', linearState: 'Review' } })
})

test('conflict where the drag already matches the new Linear state: nothing to write, move or say', () => {
  const result = drag({ from: 'todo', to: 'in-review', state: 'Todo', ticket: ticket('OEO-1', 'Review', 'started') })
  assert.deepEqual(result.writes, [])
  assert.deepEqual(result.moves, [])
  assert.deepEqual(result.warnings, [])
})

test('a Linked Workspace with no memory entry gets Linear applied, and no drag is inferred', () => {
  const result = sync({
    board: [card({ path: '/w/a', column: 'blocked', linkedIssue: 'OEO-1' })],
    tickets: [ticket('OEO-1', 'Todo', 'unstarted')],
    settings: { stateMapping: DRAG_MAPPING }
  })
  assert.deepEqual(result.writes, [])
  assert.deepEqual(movesOf(result), ['/w/a → todo'])
  assert.deepEqual(result.warnings, [])
})

test('state names compare ignoring case when spotting a conflict, so a renamed-case state is not a Linear change', () => {
  const result = drag({ from: 'todo', to: 'in-progress', state: 'todo', ticket: ticket('OEO-1', 'Todo', 'unstarted') })
  assert.deepEqual(writesOf(result), ['OEO-1 → In Progress'])
  assert.deepEqual(result.warnings, [])
})

test('with Writable Columns set to {}, every drag is reverted, even into Todo or In Progress', () => {
  const result = sync({
    board: [card({ path: '/w/a', column: 'in-progress', linkedIssue: 'OEO-1' })],
    tickets: [ticket('OEO-1', 'Todo', 'unstarted')],
    memory: { '/w/a': { column: 'todo', linearState: 'Todo' } },
    settings: { writableColumns: '{}' }
  })
  assert.deepEqual(result.writes, [])
  assert.deepEqual(movesOf(result), ['/w/a → todo'])
  assert.match(result.warnings[0]!, /OEO-1.*"in-progress" is not a Writable Column/)
})

test('Writable Columns from the settings: a drag into a column the map names sets its state', () => {
  const result = sync({
    board: [card({ path: '/w/a', column: 'po-acceptance', linkedIssue: 'OEO-1' })],
    tickets: [ticket('OEO-1', 'Review', 'started')],
    memory: { '/w/a': { column: 'in-review', linearState: 'Review' } },
    settings: { stateMapping: DRAG_MAPPING, writableColumns: '{"po-acceptance": "PO Acceptance"}' }
  })
  assert.deepEqual(writesOf(result), ['OEO-1 → PO Acceptance'])
  assert.deepEqual(result.moves, [])
})
