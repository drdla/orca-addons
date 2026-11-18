import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { DEFAULT_SETTINGS, parseSettings, POLL_MINUTES } from './settings'

test('the manifest declares every setting with the same default as the code', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as {
    contributes: { settings: { key: string; default: unknown; minimum?: number; maximum?: number }[] }
  }
  const declared = Object.fromEntries(manifest.contributes.settings.map((s) => [s.key, s.default]))
  assert.deepEqual(declared, DEFAULT_SETTINGS)
  const poll = manifest.contributes.settings.find((s) => s.key === 'pollMinutes')!
  assert.deepEqual({ min: poll.minimum, max: poll.maximum }, POLL_MINUTES)
})

test('the manifest defaults parse without problems, sync every team by type, and write back Todo, In Progress and Blocked', () => {
  const parsed = parseSettings(DEFAULT_SETTINGS)
  assert.deepEqual(parsed, {
    settings: { teams: [], overrides: [], writableColumns: { todo: 'Todo', 'in-progress': 'In Progress', blocked: 'Blocked' } },
    pollMinutes: 2,
    problems: []
  })
})

const WRITABLE_CASES: [title: string, writableColumns: string, expected: Record<string, string>][] = [
  ['a map of column ids to state names', '{"todo": "Todo", "po-acceptance": "PO Acceptance"}', { todo: 'Todo', 'po-acceptance': 'PO Acceptance' }],
  ['an empty map: no column is writable', '{}', {}],
  ['empty text: no column is writable', '  ', {}],
  ['state names are trimmed', '{" blocked ": " Blocked "}', { blocked: 'Blocked' }]
]

for (const [title, writableColumns, expected] of WRITABLE_CASES) {
  test(`Writable Columns: ${title}`, () => {
    const parsed = parseSettings({ writableColumns })
    assert.deepEqual(parsed.settings.writableColumns, expected)
    assert.deepEqual(parsed.problems, [])
  })
}

const DEFAULT_WRITABLE = { todo: 'Todo', 'in-progress': 'In Progress', blocked: 'Blocked' }

const INVALID_WRITABLE_CASES: [title: string, writableColumns: string][] = [
  ['not JSON', '{"todo": "Todo"'],
  ['not an object', '["todo"]'],
  ['a state that is not a string', '{"todo": 1}'],
  ['an empty state name', '{"todo": " "}'],
  ['a column label instead of its id', '{"PO Acceptance": "PO Acceptance"}'],
  ['an empty column id', '{"": "Todo"}']
]

for (const [title, writableColumns] of INVALID_WRITABLE_CASES) {
  test(`Writable Columns that are invalid (${title}) fall back to the default, with a problem naming the setting`, () => {
    const parsed = parseSettings({ writableColumns })
    assert.deepEqual(parsed.settings.writableColumns, DEFAULT_WRITABLE)
    assert.equal(parsed.problems.length, 1)
    assert.match(parsed.problems[0]!, /^Writable Columns: .*using the default/)
  })
}

test('the poll interval is read in whole minutes from 1 to 1440', () => {
  for (const pollMinutes of [1, 5, 1440]) {
    assert.deepEqual(parseSettings({ pollMinutes }), { ...parseSettings({}), pollMinutes }, String(pollMinutes))
  }
})

for (const pollMinutes of [0, -2, 0.5, 1.5, 1441, '5', null, Number.NaN]) {
  test(`a poll interval of ${typeof pollMinutes === 'string' ? `"${pollMinutes}"` : String(pollMinutes)} falls back to 2 minutes, with a problem naming the setting`, () => {
    const parsed = parseSettings({ pollMinutes })
    assert.equal(parsed.pollMinutes, 2)
    assert.equal(parsed.problems.length, 1)
    assert.match(parsed.problems[0]!, /^Check Linear every \(minutes\): .*using 2/)
  })
}

test('every problem names the setting it comes from', () => {
  const parsed = parseSettings({ teams: 'O E O!', stateMapping: '{', writableColumns: '[', pollMinutes: 0 })
  assert.deepEqual(
    parsed.problems.map((p) => p.split(':')[0]),
    ['Teams', 'State Mapping overrides', 'Writable Columns', 'Check Linear every (minutes)']
  )
})
