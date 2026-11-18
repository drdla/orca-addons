# Linear Board Sync

An Orca plugin that keeps each **Linked Workspace**'s **Board Column** in step with its Linear ticket. It polls Linear every 2 minutes (and at once when you create a workspace) and moves each card to the column its ticket's state maps to. Every 15 seconds it also checks the board for cards you dragged. See `GLOSSARY.md` at the repo root for the vocabulary and `docs/adr/0001-linear-board-sync-state-ownership.md` for who owns which state.

It syncs **Linear → Orca**, and writes to Linear only for a **Start** or a drag into a **Writable Column** (below). It never archives, deletes or otherwise changes a worktree beyond its Board Column. It uses Orca's own Linear connection, so it needs no credentials of its own.

## What it syncs

- **Linked Workspaces only.** A workspace is linked by Orca's own Linear link first, otherwise by an issue identifier (`OEO-123`, any case) in its branch name, such as `oeo-123-add-export`. Any other workspace is left alone.
- **Assignee doesn't matter** for the sync. A colleague's ticket you have a workspace for syncs too, but is never written.
- **Start.** When you create a workspace for a ticket in a triage, backlog or unstarted state that is yours or unassigned, the plugin sets the ticket to **In Progress** in Linear right away, without waiting for a branch push, and assigns it to you if it was unassigned. The card then lands where In Progress maps to. Only creating the workspace Starts a ticket; a poll never does. The team needs a state named exactly "In Progress".
- **Drags.** A card found in a column other than the one the plugin last put it in was dragged. A drag into a **Writable Column** on your own or an unassigned ticket sets that Linear state: `todo` → Todo, `in-progress` → In Progress, `blocked` → Blocked (fixed for now; the team needs states with exactly these names). Dragging an unassigned, not-yet-started ticket into In Progress is a Start, so it is assigned to you too. Any other drag is moved back with a status-bar message: into In Review, PO Acceptance, Done or any other column (GitLab or the PO own those states), or of a colleague's card.
  - **Linear wins.** If the ticket's state changed in Linear since the plugin last saw it, the card goes where Linear says and the drag is discarded, with a status-bar message.
  - A card the plugin has no memory of (first run, reinstall, after resuming) gets Linear applied; no drag is inferred.
  - The card stays where you dropped it. If the State Mapping puts the new state in another column (Blocked without a `"Blocked": "blocked"` override lands in In Progress), the next poll moves it there.
- **A failed Linear write** is shown as a warning in the status bar and logged, and not retried; the card follows Linear at the next poll.
- **A failed card move** (for example, an override naming a column your board doesn't have) is skipped, logged, and shown as a warning in the status bar. Other cards still sync. It is tried again at the next poll, not before.

The status bar item shows **Linear** while sync runs, **Linear: N warnings** when something went wrong (hover for the list), or **Linear: paused**. Click it to sync now. Drag messages stay listed until the next Linear poll.

Commands: **Linear Board Sync: Sync now** (polls Linear and checks the board at once), and **Linear Board Sync: Pause** (stops both; run it again to resume, which discards drags made while paused and re-applies Linear to every card).

## Settings

In Orca's **Settings → Plugins → Linear Board Sync**.

### Teams

Linear team keys to sync, separated by commas, spaces or new lines. Empty means all teams. When a key exists in several Linear workspaces, write `<workspace>/<key>`, where `<workspace>` is the part after `linear.app/` in your Linear URLs.

```
OEO, vestigas/COR
```

### Check Linear every (minutes)

The poll interval. Default 2.

### State Mapping overrides

By default a ticket maps by its Linear **state type**, onto Orca's four built-in columns only:

| Linear state type            | Board Column  |
| ---------------------------- | ------------- |
| triage, backlog, unstarted   | `todo`        |
| started                      | `in-progress` |
| completed, canceled          | `completed`   |

Overrides map a **state name** (case-insensitive) to a Board Column id, as JSON. Prefix the state with a team key to scope it to that team; a team-scoped override beats an unscoped one. A custom column's id is the slug of its label when you created it (a column created as "PO Acceptance" has the id `po-acceptance`).

**Worked example (the OEO board).** The board has the columns `todo`, `in-progress`, `blocked`, `in-review` (labelled Review), `po-acceptance` and `completed` (labelled Done). Without overrides, Blocked and Review tickets are `started` and land in In Progress, so OEO sets:

```json
{
  "Blocked": "blocked",
  "Review": "in-review",
  "PO Acceptance": "po-acceptance",
  "Icebox": "todo"
}
```

If another synced team also has a "Review" state that should stay in In Progress, scope the override: `{"OEO/Review": "in-review"}`.

## Layout

- `orca-plugin.json`: the manifest.
- `src/sync/sync.ts`: the sync core, a pure function: (Linear teams and tickets, board, memory, settings, the workspace just created) → (card moves, Linear writes, warnings, new memory), drags included. All sync rules live here, tested in `sync.test.ts`.
- `src/settings.ts`: the settings, their defaults and parsing (the test host and `orca plugin check` don't apply manifest defaults).
- `src/worker.ts`: runs the Linear poll and the 15 s board check, gathers inputs, applies Linear writes then card moves, persists the memory, draws the status bar.
- `src/orca-cli-process.ts`: the only code that spawns `orca` (`worktree list`, `worktree set --workspace-status`, `linear team list`, `linear issue`, `linear list-issues --assignee me` to learn your Linear id, `linear status set`, `linear assignee set --me`). `src/seams/orca-cli.ts` is its interface; `src/fakes/` holds the test doubles.

## Develop

```sh
npm install                 # TypeScript and Node typings, for type-checking only
orca plugin types .         # writes .orca/types (gitignored)
npx tsc -p .                # type-check
orca plugin test .          # unit and worker tests
orca plugin check .         # runs the real worker once, which stays idle without settings
orca plugin dev watch .     # load into Orca and reload on save
```

`activate` must not spawn `orca` or start timers until the settings hold `pollMinutes`: real Orca fills in the manifest defaults, `orca plugin check` does not, and a check run must never move real cards.
