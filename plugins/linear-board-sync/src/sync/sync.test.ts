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

function ticket(identifier: string, stateName: string, stateType: string, where = VESTIGAS): Ticket {
  return { identifier, teamKey: identifier.split('-')[0]!, stateName, stateType, ...where }
}

function sync(input: {
  board: BoardCard[]
  tickets: Ticket[]
  memory?: Memory
  settings?: Record<string, unknown>
}) {
  return syncBoard({
    linear: { teams: TEAMS, tickets: input.tickets },
    board: input.board,
    memory: input.memory ?? {},
    settings: parseSettings(input.settings ?? {}).settings
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
