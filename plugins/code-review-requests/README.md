# Code Review Requests

An Orca plugin that lists your GitLab **Review Requests** (open, non-draft merge requests where you are a Reviewer and haven't approved): a count in the status bar, a panel, and review workspaces. See `GLOSSARY.md` at the repo root for the vocabulary.

## Layout

- `orca-plugin.json`: the manifest. It declares every v1 capability and contribution up front, so updates keep the user's approval.
- `src/worker.ts`: the worker. `createActivate(deps)` builds `activate`; the default export uses `realDeps()` from `src/deps.ts`.
- `src/panel.tsx`: the components panel. `src/panel.check.ts` has one `orca plugin check` scenario per panel state.
- `src/protocol.ts`: the panel/worker request contract.
- `src/settings.ts`: the settings and their defaults (the test host and `check` don't apply manifest defaults).
- `src/seams/`: the outside world, behind interfaces: `GitLabTransport`, `OrcaCli`, `Clock`.
- `src/fakes/`: in-memory doubles for each seam (`fakeDeps()`), including a stateful fake GitLab.
- `src/smoke/`: the opt-in live smoke script (see below). The plugin never loads it.

## Develop

```sh
npm install                 # TypeScript and Node typings, for type-checking only
orca plugin types .         # writes .orca/types (gitignored)
npx tsc -p .                # type-check
orca plugin test .          # unit and integration tests (node:test)
orca plugin check .         # renders the panel per scenario, with the real worker
orca plugin dev watch .     # load into Orca and reload on save
```

`activate` must not reach GitLab, spawn `glab` or `orca`, or start timers until GitLab is configured: `orca plugin check` runs the real worker once per scenario.

## Live smoke test

The tests only reach the fakes. `src/smoke/` is an opt-in script that runs the plugin's own modules (the glab transport, the Review Requests and approvals queries, `glab auth status` parsing, the orca CLI adapter, the Review Draft poster) against your real GitLab and Orca. It needs Node 22.18 or newer (it runs the TypeScript directly) and a `glab auth login`.

```sh
npm run smoke                      # read-only: writes nothing to GitLab or Orca
npm run smoke -- --host gitlab.example.com   # check that host instead of glab's first login
```

The read-only run checks glab (found, logged in), the GitLab version, the current user, the Review Requests query and its response shape, the reviewers call behind "requested at", the optional approvals query, and the JSON of `orca worktree list` and `orca worktree ps`. It prints PASS, WARN, FAIL or SKIP per check and exits 1 if any check failed. A shape note such as "keys added or missing vs. the capture" means the live answer drifted from the sanitized captures in `src/fixtures/`; it fails only for a field the plugin reads.

```sh
npm run smoke -- --post --mr https://gitlab.example.com/group/project/-/merge_requests/7
npm run smoke -- --post --mr <url> --file src/a.ts --line 12   # put the line comment here
npm run smoke -- --post --mr <url> --approve                   # also approve the MR
```

`--post` writes to that one MR only, so use a sandbox MR you own. It publishes one review with two Review Comments, a line comment on the first added line of the diff (or `--file`/`--line`) and a general comment, plus a summary. Every body is tagged `[crr-smoke-<id> …]`. Approving needs `--approve` as well. Before writing anything, it prints the plan and waits for you to type `post` (`--yes` skips the prompt). It refuses to run when you have your own pending drafts on the MR, because publishing would publish them too. Afterwards it reports the note URLs, whether the line comment landed as a diff note, whether the summary shows up, and that no drafts were left behind.
