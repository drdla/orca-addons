// The OrcaCli seam: every read and write goes through the `orca` CLI, because the host API has
// no call to set a workspace's Board Column. The real adapter (src/orca-cli-process.ts) is the
// only code that spawns `orca`; tests use src/fakes/fake-orca-cli.ts.
import type { BoardCard, LinearTeam, Ticket, TicketRef } from '../sync/sync'

export interface OrcaCli {
  /** Every workspace on the board (`orca worktree list`). */
  board(): Promise<BoardCard[]>
  /** The teams of every connected Linear workspace (`orca linear team list`). */
  linearTeams(): Promise<LinearTeam[]>
  /** One ticket (`orca linear issue`), through Orca's own Linear connection. */
  ticket(ref: TicketRef): Promise<Ticket>
  /** Moves a card to a Board Column (`orca worktree set --workspace-status`). */
  setColumn(worktreeId: string, column: string): Promise<void>
  /** Sets a ticket's state by its exact name (`orca linear status set`). */
  setState(ref: TicketRef, state: string): Promise<void>
  /** Assigns a ticket to the user (`orca linear assignee set --me`). */
  assignToMe(ref: TicketRef): Promise<void>
}

/** A failed `orca` call: `code` is the envelope's error code, or `unavailable`/`unexpected_output`. */
export class OrcaCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'OrcaCliError'
  }
}
