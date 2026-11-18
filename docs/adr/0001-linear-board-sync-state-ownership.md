# 1. Linear Board Sync: who owns which ticket state

Date: 2026-11-18
Status: Accepted

## Context

A Linear ticket's state is set by several parties. The user decides some states (starting work, being blocked, putting a ticket back). The GitLab integration drives others (MR opened → Review, merged → Done), and the PO decides acceptance. Orca's workspace board shows a Board Column per workspace, which the user can drag freely.

Linear Board Sync (`plugins/linear-board-sync`) keeps each Linked Workspace's Board Column in step with its ticket. If both sides could write every state, a stale drag could overwrite a transition GitLab or the PO just made, and two sources of truth would drift.

## Decision

- **Linear is the source of truth.** The plugin always moves cards to the Board Column the ticket's state maps to (State Mapping).
- **Orca owns only the states a person decides:** Todo, In Progress and Blocked, the default Writable Columns. A drag into a Writable Column sets that Linear state; a drag into any other column is reverted. Creating a workspace for a not-yet-started ticket is a Start.
- **GitLab and the PO own the rest** (Review, PO Acceptance, Done, and anything else). The plugin never writes them.
- **Linear wins conflicts.** When Linear changed and the card was dragged since the last check, Linear's state is applied and the drag discarded.
- **Only the user's own or unassigned tickets are ever written.** Colleagues' tickets sync Linear → Orca only.
- **Never beyond the Board Column.** The plugin does not archive, delete or otherwise change a worktree, and never reads or writes Orca's internal profile or storage files; all reads and writes go through the `orca` CLI.

## Consequences

- The board can be trusted to match Linear within one poll, and a drag can never claim a transition GitLab or the PO owns.
- Which columns are writable, and which state each writes, is a setting, so other teams can draw the line differently.
- The first slice shipped Linear → Orca only; the Start rule, drag write-back and the Writable Columns setting followed in their own slices on top of this ownership.
