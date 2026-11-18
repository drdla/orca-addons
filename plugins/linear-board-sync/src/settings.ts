// The plugin's settings: their defaults, and parsing what Orca hands over into the shape the sync
// core reads. Orca applies the manifest's `contributes.settings` defaults, but the test kit and
// `orca plugin check` do not, so code always reads through parseSettings().

export const DEFAULT_SETTINGS = {
  /** Team keys or `<workspace>/<key>`, separated by commas, spaces or new lines; empty = all. */
  teams: '',
  /** The Linear poll interval in minutes. */
  pollMinutes: 2,
  /** State Mapping overrides: JSON `{ "<state name>" | "<team key>/<state name>": "<column id>" }`. */
  stateMapping: '{}'
}

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

/** The default Writable Columns. Not a setting yet: hard-coded until a later slice exposes it. */
export const DEFAULT_WRITABLE_COLUMNS: Record<string, string> = {
  todo: 'Todo',
  'in-progress': 'In Progress',
  blocked: 'Blocked'
}

export type ParsedSettings = {
  settings: SyncSettings
  pollMinutes: number
  /** What could not be read, in words for the status bar. */
  problems: string[]
}

export function parseSettings(stored: Record<string, unknown>): ParsedSettings {
  const problems: string[] = []
  const overrides = parseOverrides(stringOr(stored.stateMapping, DEFAULT_SETTINGS.stateMapping), problems)
  const teams = parseTeams(stringOr(stored.teams, DEFAULT_SETTINGS.teams), problems)
  const pollMinutes =
    typeof stored.pollMinutes === 'number' && Number.isFinite(stored.pollMinutes) && stored.pollMinutes >= 1
      ? stored.pollMinutes
      : DEFAULT_SETTINGS.pollMinutes
  return { settings: { teams, overrides, writableColumns: { ...DEFAULT_WRITABLE_COLUMNS } }, pollMinutes, problems }
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
      problems.push(`Teams: "${word}" is not a team key like OEO or vestigas/OEO.`)
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
 * shaped like a team key is scoped to that team. Anything but an object of non-empty strings is
 * reported and ignored as a whole, so a typo never maps half the states.
 */
function parseOverrides(text: string, problems: string[]): StateOverride[] {
  if (text.trim() === '') return []
  const fail = (why: string): StateOverride[] => {
    problems.push(`State Mapping overrides ignored: ${why}`)
    return []
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return fail('not valid JSON.')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('not a JSON object like {"Review": "in-review"}.')
  }
  const overrides: StateOverride[] = []
  for (const [key, column] of Object.entries(value)) {
    if (typeof column !== 'string' || column.trim() === '') {
      return fail(`"${key}" needs a Board Column id as a string.`)
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

/** State names compare ignoring case and surrounding spaces. */
export function normalState(name: string): string {
  return name.trim().toLowerCase()
}
