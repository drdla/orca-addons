# What Orca already offers for GitLab MRs and review workflows

Research for [#3](https://github.com/drdla/orca-addons/issues/3), part of map [#1](https://github.com/drdla/orca-addons/issues/1).
Checked against Orca **1.4.259**, host API **1.9**, on 2026-11-16.

## Sources

Each claim below cites one of these sources.

- **[CLI]** `orca agent-context --json` (the CLI's command schema) and the `--help` text for `reference *`, `worktree create|set|list|rm`, `plugin open`.
- **[host-api]** `orca skills get orca-plugin-authoring --reference references/host-api.md` (generated from Orca's source).
- **[manifest]**, **[events]**, **[recipes]**: the same skill's `references/manifest.md`, `events.md` and `recipes.md`.
- **[skill]** `orca skills get orca-plugin-authoring` (the main SKILL text).
- **[types]** `/Applications/Orca.app/Contents/Resources/plugins/types/orca-worker.d.ts`, `orca-host.d.ts`.
- **[compiled]** files under `/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/`, plus `app.asar`.
- **[upstream]** `github.com/stablyai/orca` `main`, read through `gh api`. These files are named inline.
- **[observed]** read-only CLI output on this machine: `orca worktree list --json` and `orca reference find … --json`.

## TL;DR

| Question | Answer |
| --- | --- |
| Where is the workspace-to-MR link stored? | In Orca's per-worktree metadata: the legacy `linkedGitLabMR` field (an MR iid) and the newer `linkedItems[]` field (`{provider:"gitlab", type:"mr", number, url, title}`). Both live in the Orca profile store (`profiles/<profile>/profile-state.db`). |
| Can a plugin read the link? | **Not through the host API.** `workspace.list` returns no link fields. A `trusted-worker` is plain Node, so it can run `orca worktree list --json` or `orca reference find <MR URL> --json`, which do return the links. This route is undocumented for plugins. |
| Can a plugin create a workspace for an MR? | Partly. `workspace.create` (capability `workspace:create`, since 1.8) takes `projectId`, `name` and `baseBranch`. It can't attach an MR link or check out the MR head. The CLI (`orca worktree create --gitlab-mr` or `--reference <url>`) can attach the link. |
| Can a plugin remove a workspace? | **No host method exists.** The only route is the CLI, `orca worktree rm --worktree id:<id>`, called by shelling out. A plugin *can* observe removals through the `workspace.removed` event. |
| Built-in MR or review views? | Yes, but scoped to one repository. The Tasks page has a GitLab MRs view with a "Reviewing" filter (`reviewer_id=<me>`, through `glab`) and a GitLab To-dos view. There are also an MR detail dialog, MR and pipeline display per worktree, "Start workspace from MR", and MR info in Workspace Cleanup. Plugin `taskSources`, `sidebarCards` and `connections` are reserved and can't be built yet. |
| `notifications.show` | Takes `{title, body?}` and returns `{delivered}`. There are no action buttons, click handlers, grouping, tags or persistence. Orca prefixes the title with the plugin id and shows a plain Electron `Notification`. |
| Status bar and panel | Up to 8 status-bar items with `text`, `icon`, `tone` and `tooltip`. A worker updates them through `statusBar.update`. There is no badge field, so a count goes in `text` and `tone`. Pressing an item runs one of the plugin's commands. The host API has no method to open a panel, but `orca plugin open <key> --panel <id>` does it from the CLI. |

## 1. Workspace-to-MR linkage

### How a link is made

- `orca worktree create … --gitlab-mr <number-or-url>` and `orca worktree set --worktree <sel> --gitlab-mr <number-or-url|null>` write the GitLab MR link. Notes from the CLI schema say: "`--gitlab-issue` and `--gitlab-mr` write separate GitLab links. GitLab URLs must match the stored source project or remote; they cannot select a foreign project." Pass `--gitlab-mr null` to clear only that link. [CLI]
- The newer generic route is `orca reference add <url>... --worktree <sel>`, along with `reference list`, `reference remove` and `reference find <url-or-key>`. `worktree create --reference <url>` is repeatable but "cannot combine with legacy link flags". `reference find` "reads stored references only" and returns up to 50 workspaces. [CLI]
- Orca's own UI also writes this link when it starts a workspace from an MR (see section 3).

### Where the link is stored

- The per-worktree metadata defaults include `linkedGitLabMR: null` and `linkedGitLabIssue: null`, alongside `linkedPR`, `linkedWorkItem`, `linkedTaskSourceContext` and others. [compiled] `shared/worktree/metadata/meta-persisted-defaults.js`
- The legacy fields map onto attachments as `['linkedGitLabMR', 'gitlab', 'mr']`. A normalized linked item is `{provider: 'github'|'gitlab'|'linear'|'jira', type: 'issue'|'pr'|'mr', number, title, url, repoId?}`. [compiled] `shared/workspace-attachments/workspace-attachment-legacy.js`, `workspace-linked-item.js`
- On disk, the data lives in Orca's profile store, `~/Library/Application Support/orca/profiles/local-default/profile-state.db`. This is a SQLite document store with `profile_state_documents*` tables. Nobody should read it directly: it is internal, and Orca holds it open in WAL mode. [observed]
- `orca worktree list --json` exposes the link on every row as `linkedGitLabMR` (a number or null) and `linkedItems: []`, next to `branch`, `projectId` (for example `git:gitlab.com/<group>/<project>`), `path` and `instanceId`. [observed]

### Can a plugin read it?

- **Not through the host API.** `workspace.list` (capability `workspace:read`, worker only, since 1.3) returns `{id, kind, name, project, projectId, path, branch, hostId, status?}` and no link fields. `workspace.readContext` returns only the focused workspace's id, branch, name and terminals. [host-api] [types] `orca-host.d.ts`
- **Through the CLI: yes, in practice.** The plugin worker is an ordinary Node child process. `out/main/plugin-host-entry.js` imports the plugin's `main` with Node's own module loader and only registers a resolve/transpile hook, so `node:child_process` is not blocked. A worker could run `orca worktree list --json` or `orca reference find <MR web URL> --json`. [compiled]
  - Caveats: no plugin doc describes this route, so it's undocumented. It needs the `orca` binary on the worker's `PATH`, which we haven't checked. It bypasses the consent model, so the plugin's description should say that it shells out.
- **A fallback that needs no link at all:** match MRs to workspaces by **branch**. `workspace.list` gives each workspace's `branch` and `projectId`, and an MR has `source_branch` and a project path. This is the only route that uses only host API data.

## 2. Creating and removing workspaces from a plugin

### Create

`workspace.create` needs capability `workspace:create` (since Orca 1.4.259 / host API 1.8; an `agent` param also needs `agent:launch`). It is worker-only. [host-api]

```ts
(params: { projectId: string; hostId?: string; name?: string; baseBranch?: string;
           agent?: string; prompt?: string; setup?: "skip"; open?: boolean })
  => { workspaceId: string; terminalId?: string }
```

- It "creates a workspace (a new branch and worktree) in a Git project, local or SSH". Orca's `workspace.create.before`/`.after` hooks run as for any create. [host-api]
- It has **no MR or link parameter and no `branch` parameter.** To work on an MR's source branch, pass `baseBranch: "origin/<source_branch>"`, which starts a *new* local branch from it. That still needs a `git fetch` first and gives no tracking guarantees. Linking the MR would then need a CLI call (`orca worktree set --gitlab-mr <url>` or `orca reference add`).
- The CLI is richer: `orca worktree create --repo|--project … --name … [--branch <name>] [--base-branch <ref>] [--gitlab-mr <n|url>] [--reference <url>] [--setup run|skip|inherit] [--activate] --json`. [CLI]
- Orca's built-in "Start workspace from MR" fetches the MR head into a durable ref, `refs/orca/merge-requests/<remote>-<hash>/<iid>`, and creates the worktree from that ref. [compiled] `shared/review-head-tracking-ref.js` (`gitlabMergeRequestHeadLocalRef`), string `TaskPage.startWorkspaceFromMr`. Plugins can't reach this feature.

### Remove

- The host API has **no** `workspace.remove` method. The full worker method list contains `workspace.create`, `.open`, `.rename` and `.list`, but nothing that removes. [host-api] [types]
- The only route is the CLI: `orca worktree rm --worktree id:<full-instance-id> [--force] [--delete-branch] [--run-hooks] --json`. It refuses `current` and `active`. It keeps the local branch unless `--delete-branch` is passed, and then deletes only branches it can prove are merged. [CLI]
- `workspace.open` (capability `workspace:write`) can show the workspace so the user removes it by hand. [host-api]
- A plugin can **observe** removals through the `workspace.removed` event (`workspace:read`, payload `{workspaceId, workspaceListId?, kind, path}`). The worker gets it after listing it in `contributes.events`; a panel gets it while open. [events]

**Consequence for #1:** to "offer to remove the matching Orca workspace", the plugin needs one of two things. Either it shells out to `orca worktree rm` after the user confirms, or it calls `workspace.open` to show the workspace and leaves the removal to the user.

## 3. Built-in MR and review features

Orca shells out to **`glab`** for everything GitLab. For example, `glab mr list -R <path> --source-branch … --output json`, `glab api projects/<path>/merge_requests?source_branch=…`, and `glab api todos?state=pending&per_page=50`. When `glab` isn't signed in, Orca tells the user to run `glab auth login`. [compiled] `main/chunks/orcad-retained-source-*.js` [upstream] `src/main/gitlab/merge-requests/merge-request-list.ts`, `src/main/gitlab/work-items/work-item-queries.ts`

- **Tasks page, GitLab source** (`view.tasks`): it has three views, Issues, MRs and To-dos (`TaskPage.gitlabViewIssues|gitlabViewMrs|gitlabViewTodos`). The MR view has an involvement filter, Everyone / Authored / **Reviewing**. [compiled] i18n keys `TaskPage.gitlabInvolvement*`
  - "Reviewing" adds `reviewer_id=<signed-in user id>`, which comes from the `glab` viewer lookup. State can be `opened`, `merged`, `closed` or `all`; it's paginated and searchable. [upstream] `merge-request-list.ts` (`INVOLVEMENT_PARAM = { authored: 'author_id', reviewing: 'reviewer_id' }`)
  - **The list is scoped to one repository's GitLab project** (`projects/<path>/merge_requests`), not to the whole instance. It does **not** drop drafts or MRs the user already approved. The runtime method is `gitlab.listMRs` with `involvement: 'authored'|'reviewing'`. [compiled]
  - The **To-dos** view is user-scoped across projects (`todos?state=pending`, top 50), so it includes GitLab's "review requested" to-dos. [upstream] `work-item-queries.ts`
- **MR detail dialog** (`GitLabItemDialog`): opens in GitLab, comments, approvals ("approvals remaining of required"), and editing reviewers. [compiled] i18n `GitLabItemDialog.*`, `TaskPage.editReviewersWithCurrent`
- **Per-worktree MR display**: Orca finds the open MR for a worktree's branch (`source_branch=…&order_by=updated_at`) and shows it on the worktree card, with a Checks panel for GitLab pipelines and job logs. It also offers "fix checks" agent prompts and MR creation (`glab mr create`). [compiled] `shared/source-control/checks/gitlab/*`, `worktree-card-pr-display-*.js`, `ChecksPanel-*.js`
- **New Workspace dialog**: a "smart" source search that offers "Start typing to search GitLab MRs and issues" and accepts `!77`, `#42` or MR and issue URLs from any GitLab host, including self-hosted ones. [compiled] `shared/new-workspace/smart-workspace-source-results.js`, `gitlab-links.js`
- **Workspace Cleanup**: shows each candidate's linked `MR #n` and can filter by "PR / MR" presence. [compiled] `WorkspaceCleanupDialog-*.js`
- **Reserved plugin contribution points** that must stay empty arrays: `taskSources`, `sidebarCards`, `connections`, `agentHarnesses`, `skills`, `mcpServers`. The skill says: "Sidebar cards, task sources, connections, MCP servers and skills are reserved and not buildable yet: say so instead of faking them." [manifest] [skill]
- No plugin can read Orca's GitLab data. No host method exposes the Tasks page, `glab` results or MR status.

**Overlap with #1:** Orca's "Reviewing" filter overlaps with Review Requests, but it covers one project at a time, has no draft or approved filtering, no instance-wide scope, no allowlist or blocklist, no polling notifications and no status-bar count. The plugin isn't a duplicate of it. Reusing **`glab`** as the data source matches what Orca does.

## 4. `notifications.show`

- Signature: `(params: { title: string; body?: string }) => { delivered: boolean }`. It needs capability `notifications:show` and works from worker, panel and custom editor (since API 1.0). The strict params check refuses unknown fields with `invalid_params`. [host-api] [types]
- Implementation: the title becomes `` `${pluginId}: ${title}` ``. On desktop Orca runs `new Electron.Notification({title, body}).show()` when `Notification.isSupported()`, otherwise `delivered: false`. The notification is also relayed to paired mobile clients (`source: 'plugin'`). [compiled] `app.asar` [upstream] `src/main/runtime/push/notifications/runtime-mobile-notification-controller.ts` (`dispatchPlugin`)
- **Unsupported:**
  - action buttons
  - click handlers or click-to-focus callbacks
  - grouping or tags, so no replacing or collapsing earlier notifications
  - persistence or history
  - urgency, sound or icon
  - a return id
- The plugin has to do any batching itself, for example one "3 new Review Requests" notification per poll. It has to do its own dedupe in `storage`. The "offer to remove the workspace" action **can't** live in the notification. It has to live in the panel, as a button that calls the worker through `plugin.request`.

## 5. Status bar and panel

### Status-bar items

`contributes.statusBarItems` supports at most 8 items, since 1.4.248. Each item has: [manifest] [recipes] [host-api]

- `id`
- `text`, a short label
- `icon`, from the fixed panel icon set (for example `bell`, `gauge`, `refresh` or `warning`)
- `tone`: `neutral`, `accent`, `success`, `warning` or `danger`
- `tooltip`
- `command`, the id of one of this plugin's `contributes.commands`, which runs on press

- A worker changes an item with `statusBar.update({ id, text?, icon?, tone?, tooltip?, visible? })`. That call needs no capability and is worker-only and desktop-only. The change lasts until Orca restarts.
- **No badge or count field.** Put the count in `text` (for example `3`) and use `tone`/`icon` for emphasis. `visible: false` hides the item.
- "A plugin with `main` and status bar items has its worker started when it is enabled and kept running while it stays enabled, so a worker can poll and update its items without an event or a hook." This supports the 5-minute polling design. [host-api]
- `orca plugin shot <key> --status-bar` saves a PNG of the status bar. [recipes]

### Panels

- `contributes.panels` supports at most 64 panels, each with `id`, `title`, `icon` and `entry`, and `ui` set to `html` or `components`. Panels sit in the right-sidebar activity bar. The panel tab has no badge field. [manifest]
- Panels talk to the worker through `plugin.request` (panel to worker, a handler registered with `orca.panels.handle`) and `orca.panels.post` (worker to panels, 256 KiB maximum, 200 per 10 s). Panels can call `shell.openExternal` to open an MR URL in the browser. That needs a user gesture, and Orca asks before opening a host the plugin wasn't allowed. [host-api] [types]
- Panels have **no network**, so GitLab calls must happen in the worker. [skill]

### Opening the panel from the status bar

- **The host API has no `panels.open` or reveal method.** `PanelsApi` has only `handle` and `post`. `commands.run` actions include only `sidebar.right.toggle`, which toggles the right sidebar and doesn't select a plugin panel. A declarative command `action` is limited to the same built-in list. [types] [manifest]
- The CLI can do it: `orca plugin open <plugin-key> [--panel <id>]`. It "shows the plugin's first panel, opening the right sidebar if it is closed". It never takes focus and is desktop-only. [CLI]
- So a status-bar item's `command` can be a worker command that shells out to `orca plugin open <publisher>.<id> --panel <id>`. That route is also undocumented for plugins, as in section 1. Without it, the user would click the panel's activity-bar icon.

## Open questions for later tickets

- Is the `orca` CLI on the plugin worker's `PATH`, and does it reach the same runtime without a pairing code? This needs a small spike with `orca plugin dev load`. It decides whether the CLI routes (read links, remove a workspace, open the panel) are viable.
- Should the plugin match MRs to workspaces by link, by branch, or by both?
