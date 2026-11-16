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
