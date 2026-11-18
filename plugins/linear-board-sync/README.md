# Linear Board Sync

An Orca plugin that keeps each **Linked Workspace**'s **Board Column** in step with its Linear ticket. It polls Linear every 2 minutes (and at once when you create a workspace) and moves each card to the column its ticket's state maps to. See `GLOSSARY.md` at the repo root for the vocabulary and `docs/adr/0001-linear-board-sync-state-ownership.md` for who owns which state.

This first release syncs **Linear → Orca only**. It writes nothing to Linear, and it never archives, deletes or otherwise changes a worktree beyond its Board Column. It uses Orca's own Linear connection, so it needs no credentials of its own.

## What it syncs

- **Linked Workspaces only.** A workspace is linked by Orca's own Linear link first, otherwise by an issue identifier (`OEO-123`, any case) in its branch name, such as `oeo-123-add-export`. Any other workspace is left alone.
- **Assignee doesn't matter.** A colleague's ticket you have a workspace for syncs too.
- **A failed card move** (for example, an override naming a column your board doesn't have) is skipped, logged, and shown as a warning in the status bar. Other cards still sync. It is tried again at the next poll, not before.

The status bar item shows **Linear** while sync runs, **Linear: N warnings** when something went wrong (hover for the list), or **Linear: paused**. Click it to sync now.

Commands: **Linear Board Sync: Sync now**, and **Linear Board Sync: Pause** (run it again to resume; resuming re-applies Linear to every card).

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
- `src/sync/sync.ts`: the sync core, a pure function: (Linear teams and tickets, board, memory, settings) → (card moves, warnings, new memory). All sync rules live here, tested in `sync.test.ts`.
- `src/settings.ts`: the settings, their defaults and parsing (the test host and `orca plugin check` don't apply manifest defaults).
- `src/worker.ts`: gathers inputs, applies moves, persists the memory, draws the status bar.
- `src/orca-cli-process.ts`: the only code that spawns `orca` (`worktree list`, `worktree set --workspace-status`, `linear team list`, `linear issue`). `src/seams/orca-cli.ts` is its interface; `src/fakes/` holds the test doubles.

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
