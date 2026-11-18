// An in-memory OrcaCli for worker tests: a board of cards, Linear teams and tickets, and a set of
// Board Columns that exist (a move to any other is refused, as a missing column should be).
import { OrcaCliError, type OrcaCli } from '../seams/orca-cli'
import type { BoardCard, LinearTeam, Ticket, TicketRef } from '../sync/sync'

export type CardSeed = { name: string; branch?: string; column?: string; linkedIssue?: string }

export const VESTIGAS_TEAMS: LinearTeam[] = [
  { key: 'OEO', workspaceId: 'ws-v', workspace: 'vestigas' },
  { key: 'COR', workspaceId: 'ws-v', workspace: 'vestigas' }
]

export class FakeOrcaCli implements OrcaCli {
  /** Every call, as `<command> <args>`, in order. */
  readonly calls: string[] = []
  /** The board's Board Column ids; Orca's four built-ins unless a test adds more. */
  readonly columns = new Set(['todo', 'in-progress', 'in-review', 'completed'])
  teams: LinearTeam[] = [...VESTIGAS_TEAMS]
  #cards: BoardCard[] = []
  #tickets = new Map<string, Ticket>()
  #failing = new Map<string, OrcaCliError>()

  addCard(seed: CardSeed): BoardCard {
    const path = `/worktrees/${seed.name}`
    const card: BoardCard = {
      worktreeId: `repo-1::${path}`,
      path,
      branch: seed.branch ?? seed.name,
      column: seed.column ?? 'in-progress',
      linkedIssue: seed.linkedIssue ?? null,
      linkedWorkspaceId: seed.linkedIssue ? 'ws-v' : null
    }
    this.#cards.push(card)
    return card
  }

  removeCard(name: string): void {
    this.#cards = this.#cards.filter((c) => c.path !== `/worktrees/${name}`)
  }

  setTicket(identifier: string, stateName: string, stateType: string, assignee: Ticket['assignee'] = 'me'): void {
    this.#tickets.set(identifier, {
      identifier,
      workspaceId: 'ws-v',
      workspace: 'vestigas',
      teamKey: identifier.split('-')[0]!,
      stateName,
      stateType,
      assignee
    })
  }

  ticketOf(identifier: string): Ticket | undefined {
    return this.#tickets.get(identifier)
  }

  /** Makes every call of `command` (board, linearTeams, ticket, setColumn, setState, assignToMe) fail until cleared. */
  fail(command: string, error = new OrcaCliError('unavailable', `${command} failed`)): void {
    this.#failing.set(command, error)
  }

  columnOf(name: string): string | null {
    return this.#cards.find((c) => c.path === `/worktrees/${name}`)?.column ?? null
  }

  moves(): string[] {
    return this.calls.filter((c) => c.startsWith('setColumn ')).map((c) => c.slice('setColumn '.length))
  }

  /** The Linear writes, as `setState <identifier> → <state>` and `assignToMe <identifier>`. */
  writes(): string[] {
    return this.calls.filter((c) => c.startsWith('setState ') || c.startsWith('assignToMe '))
  }

  async board(): Promise<BoardCard[]> {
    this.#record('board')
    return this.#cards.map((c) => ({ ...c }))
  }

  async linearTeams(): Promise<LinearTeam[]> {
    this.#record('linearTeams')
    return this.teams.map((t) => ({ ...t }))
  }

  async ticket(ref: TicketRef): Promise<Ticket> {
    this.#record('ticket', ref.identifier)
    const ticket = this.#tickets.get(ref.identifier)
    if (!ticket) throw new OrcaCliError('linear_network_error', 'Entity not found: Issue')
    return { ...ticket }
  }

  async setColumn(worktreeId: string, column: string): Promise<void> {
    const card = this.#cards.find((c) => c.worktreeId === worktreeId)
    this.#record('setColumn', `${card?.path.split('/').at(-1)} → ${column}`)
    if (!this.columns.has(column)) throw new OrcaCliError('invalid_argument', `Unknown workspace status: ${column}`)
    if (card) card.column = column
  }

  async setState(ref: TicketRef, state: string): Promise<void> {
    this.#record('setState', `${ref.identifier} → ${state}`)
    const ticket = this.#tickets.get(ref.identifier)
    if (!ticket) throw new OrcaCliError('linear_network_error', 'Entity not found: Issue')
    // Every team in the fakes has an "In Progress" state of type started.
    this.#tickets.set(ref.identifier, { ...ticket, stateName: state, stateType: state === 'In Progress' ? 'started' : ticket.stateType })
  }

  async assignToMe(ref: TicketRef): Promise<void> {
    this.#record('assignToMe', ref.identifier)
    const ticket = this.#tickets.get(ref.identifier)
    if (!ticket) throw new OrcaCliError('linear_network_error', 'Entity not found: Issue')
    this.#tickets.set(ref.identifier, { ...ticket, assignee: 'me' })
  }

  #record(command: string, args?: string): void {
    this.calls.push(args === undefined ? command : `${command} ${args}`)
    const error = this.#failing.get(command)
    if (error) throw error
  }
}
