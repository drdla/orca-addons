# Can a plugin read the comments made in Orca's diff view?

Research for [#12](https://github.com/drdla/orca-addons/issues/12), part of map [#1](https://github.com/drdla/orca-addons/issues/1). Checked against Orca 1.4.259 (host API 1.9) on macOS, and upstream `stablyai/orca` `main` on 2026-11-16.

## Short answer

- Orca calls diff-view comments **review notes** (`DiffComment` in code). They are stored on the workspace's metadata in Orca's `orca-data.json`, not in git and not on any forge.
- A note has a file, a line or line range on the **new side only**, a body, timestamps, an optional diff scope, and a `sentAt` mark. It has **no author, no commit SHA, no resolved state, and no threads**.
- **Reading works today through the CLI:** `orca worktree show --worktree <selector> --json` returns the raw `diffComments` array. The plugin host API has no method or event for notes.
- **Writing has no supported route.** The runtime RPC `worktree.set` accepts a whole `diffComments` list, and the desktop UI uses it, but the `orca worktree set` CLI exposes no flag for it and the host API has nothing. "Mark as posted" (`sentAt`) is part of the same list, so it has no supported route either.
- **An agent cannot add notes** through any supported surface, so Agent Review findings can't show up as diff-view notes yet.
- **Mapping to GitLab:** `filePath` + `lineNumber` is a new-file line. For a review workspace in the default "branch" scope, Orca diffs `merge-base(baseRef, HEAD)` against HEAD, which is the same base GitLab uses for an MR diff, as long as the workspace's `baseRef` is the MR's target branch and HEAD is the MR's head. The plugin must supply the SHAs and compute `old_line` itself.

## 1. Where notes are stored, and their shape

**Storage.** Notes live on `WorktreeMeta.diffComments` (and `FolderWorkspace.diffComments` for folder workspaces), persisted in `orca-data.json` in Orca's user-data directory.

- Upstream comment at the top of `src/shared/file-review/diff-comment-types.ts`: "Persist line review notes on WorktreeMeta for existing orca-data.json storage and later agent handoff."
- Compiled main process: the persisted-state path map lists `dormantState.worktreeMeta[].meta.diffComments[].filePath` and `folderWorkspaces[].diffComments[].filePath` (`out/main/chunks/orcad-retained-source-*.js`).
- The renderer saves the whole list with `window.api.worktrees.updateMeta({ worktreeId, updates: { diffComments } })` locally, or the runtime RPC `worktree.set` with `{ worktree, diffComments }` for a remote host (`out/renderer/assets/store-*.js`).

**Shape.** This is the upstream type, `src/shared/file-review/diff-comment-types.ts`. The zod schema in `out/shared/diff-comment-schema.js` matches it.

```ts
export type DiffComment = {
  id: string
  worktreeId: string
  filePath: string
  /** Undefined means a legacy diff note. */
  source?: 'diff' | 'markdown'
  /** Exact text selected when creating a markdown note, when available. */
  selectedText?: string
  /** Inclusive range start. Must be <= lineNumber when present. */
  startLine?: number
  lineNumber: number
  body: string
  createdAt: number
  updatedAt?: number
  /** Set after the note has been handed to an agent. Edits clear it. */
  sentAt?: number
  scope?: 'unstaged' | 'staged' | 'branch'
  oldPath?: string
  diffIdentity?: string
  // Reserved for future "comments on the original side" — always 'modified' in v1.
  side: 'modified'
}
```

What this means for each thing the ticket asks about:

| Asked for | What Orca stores |
|---|---|
| File | `filePath` (relative to the worktree), plus `oldPath` for a rename |
| Line or range | `lineNumber`, and `startLine` for a range (inclusive). The UI labels them `Line N` or `Lines A-B` (`store-*.js`) |
| Side | Always `'modified'` (the new file). The old side is "reserved for future" |
| Commit | **Not stored.** `scope` says which diff the note was made on (`unstaged`, `staged` or `branch`). `diffIdentity` is an opaque hash that only the mobile app sets (from scope, merge base, head OID and file status) to spot stale notes (`mobile/src/source-control/review/diff-state/mobile-diff-review-queue.ts`). |
| Author | **Not stored.** Notes are the local user's |
| Resolved state | **Not stored.** The only state is `sentAt`: "Set after the note has been handed to an agent. Edits clear it." |
| Threads | **None.** Each note is a single body. There are no replies |

`source: 'markdown'` notes come from the markdown preview, not the diff, and carry `selectedText`. The plugin should post only `source !== 'markdown'` notes (undefined means a legacy diff note).

Orca's own use of notes is **Send to agent / copy to clipboard**. The send menu filters unsent notes with `!e.sentAt` (`out/renderer/assets/DiffNotesSendMenu-*.js`).

## 2. How a plugin can read them, and whether it can write them

**Host API: no.** The typings in `/Applications/Orca.app/Contents/Resources/plugins/types/` (`orca-host.d.ts`, `orca-worker.d.ts`, `orca-services.d.ts`) never mention comments, notes, diffs or reviews. `workspace.list` rows carry id, kind, name, project, path, branch, host and status only. The plugin-authoring references `host-api.md`, `events.md`, `recipes.md` and `cli.md` have no matches for comment, diff or annotation either. No event fires when a note changes: `workspace.changed` covers focus and terminal changes only (`events.md`).

**CLI: yes, read-only.** `orca worktree show --worktree <selector> --json` returns the workspace's metadata as is, `diffComments` included, when the field is set. A read-only run on a local workspace returned `"diffComments": []` among the other meta fields. `orca worktree list --json` and `worktree ps` do **not** include the field. The CLI's own source (`out/cli/`) never names `diffComments`, so `show` passes the field through rather than formatting it. Since the worker can spawn the `orca` CLI by absolute path ([orca-worker-reach](https://github.com/drdla/orca-addons/blob/research/orca-worker-reach/research/orca-worker-reach.md)), the plugin can read notes this way. For a workspace id from the host API, the selector is `id:<repoId>::<path>`, the form `worktree list` prints. Check that the host API's `workspaceId` is the same string when building.

The "Worktree Comments" section of the `orca-cli` skill is about something else. A *worktree comment* is the one-line status text on the workspace card (`orca worktree set --comment "..."`), stored as `comment`. It is not a diff-view note.

**Writing or marking as posted: no supported route.**

- `orca worktree set` has no `diffComments` flag (`orca worktree set --help`).
- The runtime RPC `worktree.set` does accept `diffComments` (the full new list) plus `diffCommentsBase` (the list the writer started from, so "the host applies only its changes so other devices' notes survive"): `out/shared/rpc-contract/workspaces/worktree-params.js`. But only Orca's own clients call it. Calling it from a plugin would mean reusing the CLI's internal transport and auth token (`out/cli/runtime/transport.js`, `orca-runtime.json`). That is undocumented, unsupported and could break in any update.
- Editing `orca-data.json` directly while Orca runs would race with Orca's own writes. Don't.

So the plugin should track "posted" itself, for example by note `id` (plus `updatedAt`) in plugin storage, rather than writing `sentAt`. `sentAt` means "handed to an agent", not "posted to GitLab", anyway.

## 3. Can an agent add notes?

Not through a supported surface. Notes are made in the diff view's UI (desktop or mobile), and the only programmatic write is the internal `worktree.set` RPC above. Neither the CLI nor the host API lets an agent or plugin add one. Orca's built-in flow goes the other way: the user writes notes, then **Send to agent** puts them in an agent's prompt.

For the Agent Review, findings would need another path into the curation step, for example the agent writes them to a file and the plugin shows them in its own panel for the user to pick from. An upstream feature request for a CLI or host method to add review notes would be the clean fix.

## 4. Mapping a note to the GitLab MR diff

- **Orca's branch diff base.** The "branch" scope compares the workspace's `baseRef` with the current branch through `git merge-base <baseOid> <headOid>` (`src/main/git/source-control/comparisons/compare-ref-oids.ts`, and `GitBranchCompareSummary { baseRef, baseOid, compareRef, headOid, mergeBase }` in `src/shared/git/diff/git-diff-compare-types.ts`). `worktree show --json` reports `baseRef`.
- **GitLab's MR diff base** is also the merge base of the target branch and the source head. The MR's `diff_refs` give `base_sha`, `start_sha` and `head_sha`.
- **When they agree:** the workspace was created from the MR (`orca worktree create --gitlab-mr`, which resolves the MR base through `worktree.resolveMrBase { mrIid, sourceBranch, targetBranch }`), so `baseRef` is the target branch, and the local HEAD equals the MR's `head_sha`, with no newer local commits and an up-to-date target. Then a note's `filePath` + `lineNumber` is the MR's `new_path` + `new_line`.
- **What the plugin must supply:** notes store no SHA, so the plugin takes `base_sha`, `start_sha` and `head_sha` from the MR at post time, and should check that the workspace HEAD equals `head_sha`. If it doesn't, warn instead of posting at shifted lines.
- **Old side and context lines:** a note is always on the new side. For an added line, GitLab needs only `new_line`. For an unchanged context line, a GitLab diff note needs both `old_line` and `new_line`, so the plugin has to compute `old_line` from the diff hunk. A line outside the MR diff can't be a diff note at all. Post it as a general draft note quoting the file and line.
- **Ranges:** `startLine`..`lineNumber` maps to GitLab's multi-line `line_range`, or the plugin can anchor at `lineNumber` and mention the range in the body.
- **Notes in `unstaged` or `staged` scope** are on uncommitted changes, which the MR doesn't contain. Skip them or warn.

## Sources

- `orca skills get orca-cli`, section "Worktree Comments"
- `orca skills get orca-plugin-authoring --reference references/{host-api,events,recipes,cli}.md`
- `/Applications/Orca.app/Contents/Resources/plugins/types/*.d.ts`
- `orca worktree set --help`, `orca worktree show --json` (read-only run)
- Compiled app `/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/`: `shared/diff-comment-schema.js`, `shared/rpc-contract/workspaces/worktree-params.js`, `shared/rpc-contract/workspaces/folder-workspace-params.js`, `main/chunks/orcad-retained-source-*.js`, `renderer/assets/store-*.js`, `renderer/assets/DiffNotesSendMenu-*.js`, `cli/runtime/transport.js`
- Upstream [`stablyai/orca`](https://github.com/stablyai/orca): `src/shared/file-review/diff-comment-types.ts`, `src/main/git/source-control/comparisons/compare-ref-oids.ts`, `src/shared/git/diff/git-diff-compare-types.ts`, `mobile/src/source-control/review/diff-state/mobile-diff-review-queue.ts`
