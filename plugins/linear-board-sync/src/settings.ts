// The plugin's settings: their defaults, and parsing what Orca hands over into the shape the sync
// core reads. Orca applies the manifest's `contributes.settings` defaults, but the test kit and
// `orca plugin check` do not, so code always reads through parseSettings().

export const DEFAULT_SETTINGS = {
  /** Team keys or `<workspace>/<key>`, separated by commas, spaces or new lines; empty = all. */
  teams: '',
  /** The Linear poll interval in minutes. */
  pollMinutes: 2,
  /** State Mapping overrides: JSON `{ "<state name>" | "<team key>/<state name>": "<column id>" }`. */
  stateMapping: '{"Blocked": "blocked"}',
  /** Writable Columns: JSON `{ "<column id>": "<Linear state name>" }`. */
  writableColumns: '{"todo": "Todo", "in-progress": "In Progress", "blocked": "Blocked"}'
}

/** The Writable Columns the default setting gives: Todo, In Progress and Blocked, the states a person decides (ADR 0001). */
export const DEFAULT_WRITABLE_COLUMNS: Readonly<Record<string, string>> = JSON.parse(DEFAULT_SETTINGS.writableColumns)

/** One entry of the Teams setting. `workspace` is the Linear workspace's URL key, lower case. */
export type TeamEntry = { key: string; workspace: string | null }

/** One State Mapping override. `team` is a team key, or null for every team. */
export type StateOverride = { team: string | null; state: string; column: string }

export type SyncSettings = {
  /** Empty means all teams. */
  teams: TeamEntry[]
  overrides: StateOverride[]
  /** Writable Columns: Board Column id → the Linear state name a drag into it sets. */
  writableColumns: Record<string, string>
}

export type ParsedSettings = {
  settings: SyncSettings
  pollMinutes: number
  /** What could not be read, in words for the status bar. */
  problems: string[]
}

export function parseSettings(stored: Record<string, unknown>): ParsedSettings {
  const problems: string[] = []
  const teams = parseTeams(stringOr(stored.teams, DEFAULT_SETTINGS.teams), problems)
  const overrides = parseOverrides(stringOr(stored.stateMapping, DEFAULT_SETTINGS.stateMapping), problems)
  const writableColumns = parseWritableColumns(stringOr(stored.writableColumns, DEFAULT_SETTINGS.writableColumns), problems)
  const pollMinutes = parsePollMinutes(stored.pollMinutes, problems)
  return { settings: { teams, overrides, writableColumns }, pollMinutes, problems }
}

/** The bounds of the poll interval, as the manifest declares them. */
export const POLL_MINUTES_RANGE = { min: 1, max: 1440 }

/** Whole minutes within POLL_MINUTES_RANGE; unset is the default without a problem (the test host sets none). */
function parsePollMinutes(value: unknown, problems: string[]): number {
  if (value === undefined) return DEFAULT_SETTINGS.pollMinutes
  if (typeof value === 'number' && Number.isInteger(value) && value >= POLL_MINUTES_RANGE.min && value <= POLL_MINUTES_RANGE.max) {
    return value
  }
  problems.push(
    `Check Linear every (minutes): ${JSON.stringify(value) ?? String(value)} is not a whole number of minutes from ${POLL_MINUTES_RANGE.min} to ${POLL_MINUTES_RANGE.max}; using ${DEFAULT_SETTINGS.pollMinutes}.`
  )
  return DEFAULT_SETTINGS.pollMinutes
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** `OEO, vestigas/COR`: keys, or `<workspace URL key>/<key>`, separated by commas, spaces or new lines. */
function parseTeams(text: string, problems: string[]): TeamEntry[] {
  const entries: TeamEntry[] = []
  for (const word of text.split(/[\s,]+/).filter(Boolean)) {
    const parts = word.split('/')
    const key = parts.at(-1)!
    if (parts.length > 2 || !TEAM_KEY.test(key) || (parts.length === 2 && parts[0] === '')) {
      problems.push(`Teams: "${word}" is not a team key like OEO or vestigas/OEO; skipped.`)
      continue
    }
    entries.push({ key: key.toUpperCase(), workspace: parts.length === 2 ? parts[0]!.toLowerCase() : null })
  }
  return entries
}

/** A team key as Linear writes them: letters and digits, starting with a letter. */
const TEAM_KEY = /^[A-Za-z][A-Za-z0-9]*$/

/**
 * `{"Review": "in-review", "OEO/Review": "in-review"}`. A key whose part before the first `/` is
 * shaped like a team key is scoped to that team. Empty text or `{}`: every state maps by type.
 * Anything else that is not an object of non-empty strings is reported, and the default is used
 * as a whole, so a typo never maps half the states.
 */
function parseOverrides(text: string, problems: string[]): StateOverride[] {
  if (text.trim() === '') return []
  const fail = (why: string): StateOverride[] => {
    problems.push(`State Mapping overrides: ${why}; using the default (${DEFAULT_SETTINGS.stateMapping}).`)
    return parseOverrides(DEFAULT_SETTINGS.stateMapping, [])
  }
  const value = readJsonObject(text, '{"Review": "in-review"}')
  if (typeof value === 'string') return fail(value)
  const overrides: StateOverride[] = []
  for (const [key, column] of Object.entries(value)) {
    if (typeof column !== 'string' || column.trim() === '') {
      return fail(`"${key}" needs a Board Column id as a string`)
    }
    const slash = key.indexOf('/')
    const prefix = slash === -1 ? '' : key.slice(0, slash).trim()
    const scoped = TEAM_KEY.test(prefix)
    overrides.push({
      team: scoped ? prefix.toUpperCase() : null,
      state: normalState(scoped ? key.slice(slash + 1) : key),
      column: column.trim()
    })
  }
  return overrides
}

/**
 * `{"todo": "Todo", "blocked": "Blocked"}`. Empty text or `{}`: no column is writable, so every
 * drag is reverted. Anything else that is not an object of column ids to state names is reported,
 * and the default is used as a whole, so a typo never turns drag write-back off or half on.
 */
function parseWritableColumns(text: string, problems: string[]): Record<string, string> {
  if (text.trim() === '') return {}
  const fail = (why: string): Record<string, string> => {
    const defaults = { ...DEFAULT_WRITABLE_COLUMNS }
    problems.push(`Writable Columns: ${why}; using the default (${Object.values(defaults).join(', ')}).`)
    return defaults
  }
  const value = readJsonObject(text, '{"todo": "Todo"}')
  if (typeof value === 'string') return fail(value)
  const columns: Record<string, string> = {}
  for (const [key, state] of Object.entries(value)) {
    const column = key.trim()
    if (!COLUMN_ID.test(column)) {
      return fail(`"${key}" is not a Board Column id, which is lower case without spaces, like po-acceptance`)
    }
    if (typeof state !== 'string' || state.trim() === '') return fail(`"${key}" needs a Linear state name as a string`)
    columns[column] = state.trim()
  }
  return columns
}

/** A JSON object setting's value, or why it isn't one (`example` shows the expected shape). */
function readJsonObject(text: string, example: string): Record<string, unknown> | string {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'not valid JSON'
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return `not a JSON object like ${example}`
  return value as Record<string, unknown>
}

/**
 * Shaped like a Board Column id (the slug of a label): no spaces or capitals. Catches a label written
 * instead of an id; a misspelt id passes, since the plugin can't list the board's columns.
 */
const COLUMN_ID = /^[^\sA-Z]+$/

/** State names compare ignoring case and surrounding spaces. */
export function normalState(name: string): string {
  return name.trim().toLowerCase()
}
