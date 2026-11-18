// The sync core, a pure function: given the Linear tickets, the board, the memory and the
// settings, it says which cards move, what to warn about, and what to remember. The worker only
// gathers the inputs, applies the moves and persists the memory.
import { normalState, type SyncSettings } from '../settings'

/** A workspace on Orca's board: a row of `orca worktree list`. */
export type BoardCard = {
  /** What `orca worktree set --worktree id:<worktreeId>` selects. */
  worktreeId: string
  /** The worktree's path; the memory and Orca's workspace events key on it. */
  path: string
  /** The short branch name, without `refs/heads/`. */
  branch: string | null
  /** The Board Column id, or null if Orca reports none. */
  column: string | null
  /** Orca's own Linear link: the issue identifier, or null. */
  linkedIssue: string | null
  /** The Linear workspace id of that link, if Orca recorded one. */
  linkedWorkspaceId: string | null
}

/** A Linear team, as `orca linear team list` reports it. */
export type LinearTeam = { key: string; workspaceId: string; workspace: string }

/** A Linear ticket, with what the sync reads. `workspace` is the URL key (linear.app/<key>/…). */
export type Ticket = {
  identifier: string
  /** The Linear workspace id it was read from, when the read named one. */
  workspaceId: string | null
  workspace: string
  teamKey: string
  stateName: string
  stateType: string
}

/** What the plugin remembers per Linked Workspace (keyed by path). */
export type MemoryEntry = { column: string; linearState: string }
export type Memory = Record<string, MemoryEntry>

export type CardMove = { worktreeId: string; path: string; identifier: string; from: string | null; to: string }

export type SyncInput = {
  linear: { teams: LinearTeam[]; tickets: Ticket[] }
  board: BoardCard[]
  memory: Memory
  settings: SyncSettings
}

export type SyncResult = { moves: CardMove[]; warnings: string[]; memory: Memory }

/** Default State Mapping by Linear state type. Only ever Orca's built-in Board Column ids. */
const BY_TYPE: Record<string, string> = {
  triage: 'todo',
  backlog: 'todo',
  unstarted: 'todo',
  started: 'in-progress',
  completed: 'completed',
  canceled: 'completed'
}

export function syncBoard(input: SyncInput): SyncResult {
  const moves: CardMove[] = []
  const warnings: string[] = []
  const memory: Memory = {}
  for (const card of input.board) {
    const link = linkOf(card, input.linear.teams, input.settings)
    if (link === null) continue
    if (link.kind === 'ambiguous') {
      warnings.push(
        `${card.branch}: team ${link.key} is in several Linear workspaces; name one in Teams, for example <workspace>/${link.key}.`
      )
      continue
    }
    const { ref } = link
    const ticket = input.linear.tickets.find(
      (t) => t.identifier === ref.identifier && (ref.workspaceId === null || t.workspaceId === ref.workspaceId)
    )
    if (!ticket) {
      // Not read this time: remember what we knew until it can be read again.
      const known = input.memory[card.path]
      if (known) memory[card.path] = known
      continue
    }
    if (!teamAllowed({ key: ticket.teamKey, workspace: ticket.workspace }, input.settings)) continue
    const column = columnFor(ticket, input.settings)
    if (column === null) {
      warnings.push(`${ticket.identifier}: no Board Column for state "${ticket.stateName}" (${ticket.stateType}); add a State Mapping override.`)
      const known = input.memory[card.path]
      if (known) memory[card.path] = known
      continue
    }
    if (card.column !== column) {
      moves.push({ worktreeId: card.worktreeId, path: card.path, identifier: ticket.identifier, from: card.column, to: column })
    }
    memory[card.path] = { column, linearState: ticket.stateName }
  }
  return { moves, warnings, memory }
}

/** The State Mapping: a team-scoped override, then an unscoped one, then the type default. */
function columnFor(ticket: Ticket, settings: SyncSettings): string | null {
  const state = normalState(ticket.stateName)
  const matching = settings.overrides.filter((o) => o.state === state)
  const override = matching.find((o) => o.team === ticket.teamKey) ?? matching.find((o) => o.team === null)
  return override?.column ?? BY_TYPE[ticket.stateType] ?? null
}

/** Which ticket to read for a Linked Workspace: its identifier, and its Linear workspace if known. */
export type TicketRef = { identifier: string; workspaceId: string | null }

/** The tickets the board's Linked Workspaces name, each once, in board order. */
export function ticketsToFetch(input: { teams: LinearTeam[]; board: BoardCard[]; settings: SyncSettings }): TicketRef[] {
  const refs = new Map<string, TicketRef>()
  for (const card of input.board) {
    const link = linkOf(card, input.teams, input.settings)
    if (link?.kind !== 'ref') continue
    refs.set(`${link.ref.workspaceId}/${link.ref.identifier}`, link.ref)
  }
  return [...refs.values()]
}

type Link = { kind: 'ref'; ref: TicketRef } | { kind: 'ambiguous'; key: string }

/** `<team key>-<number>`, not inside a longer word or number. */
const IDENTIFIER = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]*)-(\d+)(?![0-9])/g

/**
 * How a workspace is a Linked Workspace: Orca's own Linear link first, otherwise the first issue
 * identifier in its branch name whose key is a team the settings allow. Null: not linked.
 */
function linkOf(card: BoardCard, teams: LinearTeam[], settings: SyncSettings): Link | null {
  if (card.linkedIssue !== null) {
    const identifier = card.linkedIssue.toUpperCase()
    const key = identifier.split('-')[0]!
    if (!keyAllowed(key, settings)) return null
    const candidates = teams.filter((t) => t.key === key && teamAllowed(t, settings))
    const workspaceId = card.linkedWorkspaceId ?? (candidates.length === 1 ? candidates[0]!.workspaceId : null)
    return { kind: 'ref', ref: { identifier, workspaceId } }
  }
  for (const match of (card.branch ?? '').matchAll(IDENTIFIER)) {
    const key = match[1]!.toUpperCase()
    const candidates = teams.filter((t) => t.key === key && teamAllowed(t, settings))
    if (candidates.length === 0) continue
    if (candidates.length > 1) return { kind: 'ambiguous', key }
    return { kind: 'ref', ref: { identifier: `${key}-${match[2]}`, workspaceId: candidates[0]!.workspaceId } }
  }
  return null
}

/** The Teams setting: empty allows every team; an entry names a key, optionally in one workspace. */
function teamAllowed(team: { key: string; workspace: string }, settings: SyncSettings): boolean {
  return (
    settings.teams.length === 0 ||
    settings.teams.some((e) => e.key === team.key && (e.workspace === null || e.workspace === team.workspace))
  )
}

function keyAllowed(key: string, settings: SyncSettings): boolean {
  return settings.teams.length === 0 || settings.teams.some((e) => e.key === key)
}
