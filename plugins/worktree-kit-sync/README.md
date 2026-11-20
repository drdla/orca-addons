# Worktree Kit Sync

An [Orca](https://onorca.dev) plugin that copies your gitignored local files into every new worktree: `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/`, every `.env` file at any depth, or anything else you list. It works in every repo with nothing to set up per repo, and the files are in place before the agent starts.

Based on [balakumardev/orca-worktree-kit-sync](https://github.com/balakumardev/orca-worktree-kit-sync) 0.2.0 (MIT, see `LICENSE`). Changes from upstream:

- List entries are globs (`apps/*/.env`, `**/.env*`) instead of literal paths.
- Only files git ignores are copied; untracked files that are not ignored stay in the primary checkout.
- The defaults include `**/.env*`.

## Why

A new worktree is a clean checkout, so everything git ignores is missing: agent instructions, MCP config, local settings, secrets. The usual fixes each have a gap:

- A git `post-checkout` hook is not reliable. Some flows create the worktree with `--no-checkout` (which skips the hook), and a repo that sets its own `core.hooksPath` hides a global hook.
- Orca's per-repo setup script, Worktree Shared Paths and `.worktreeinclude` all have to be configured again in every repo.

## What it does

- On every new worktree it copies the files you list from the repo's primary checkout.
- Right before any agent starts it makes sure that copy has finished (it waits at most 1.7 s, under Orca's 2 s hook limit), so `CLAUDE.md` and `.mcp.json` exist when the agent reads them.
- It only copies files git ignores in the primary (`git ls-files -o -i --exclude-standard`), so it can never collide with the checkout of tracked files. Untracked files that are not ignored are work in progress and stay where they are.
- It never overwrites a file that already exists in the worktree, keeps symlinks as symlinks, and keeps executable bits.
- If the files add up to more than the size limit, it copies nothing and logs why.
- It never copies nested git repositories, `.git`, `worktrees/`, `node_modules/`, `*.bak-*`, `*.lock` or `.DS_Store`.
- It never blocks or denies anything. Every failure is written to the plugin log and the worktree or agent launch carries on.

## Install

```sh
git clone https://github.com/drdla/orca-addons.git
orca plugin install ./orca-addons/plugins/worktree-kit-sync
```

The first command run prints what the plugin would be granted and a fingerprint, and installs nothing. Read it, then re-run with `--approve <fingerprint>`. The plugin is a full-access worker (it runs as you), so look at `src/sync.ts` and `src/worker.ts` first; they are the whole plugin. If it is listed in a catalog you have added, you can install it from Settings, Plugins instead.

## Settings

Under Settings, Plugins, Worktree Kit Sync:

| Setting | Default | |
| --- | --- | --- |
| Files and folders to copy | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.mcp.json`, `.cursorrules`, `.cursorignore`, `.cursor/mcp.json`, `.claude`, `.run`, `.ai`, `.codex`, `.augment`, `**/.env*` | One glob per line, relative to the repo root. `#` starts a comment. Clear the box to turn copying off. |
| Size limit (MB) | 50 | All or nothing: over the limit, nothing is copied. |

Globs work as in `.gitignore` (git's `:(glob)` pathspec):

- `*` matches within one folder: `apps/*/.env` matches `apps/web/.env` but not `apps/web/e2e/.env`.
- `**` crosses folders, including none: `**/.env*` matches `.env`, `.env.local` and `apps/web/e2e/tests/.env`.
- A folder name copies everything in it: `.claude` copies `.claude/agents/x/y.md`.
- A line starting with `:`, an absolute path and any `..` are rejected.

`**/.env*` copies your secrets into every worktree of every repo, because that is what a worktree needs to run. Remove the line if you don't want that. `.env.example` and other tracked files are never copied; they come with the checkout. Files inside `node_modules/` are skipped.

## How it works

It subscribes to `workspace.created` and the `workspace.create.after` hook (observe only), and to the awaited `agent.launch.before` hook. For a worktree it runs `git rev-parse`, `git worktree list` and `git ls-files -o -i --exclude-standard` to find the primary checkout and the candidate files, then copies them with Node's file APIs. It runs no other program, uses no network and collects no data.

## Limits

- Tested on macOS. Linux should work. Windows is untested (creating symlinks may need extra privileges there).
- Orca's plugin system is experimental and may change.
- A worktree you create outside Orca (for example `git worktree add` in a terminal) is not covered.

## Develop

```sh
npm install
npm run types
npm run typecheck
orca plugin validate .
orca plugin test .
```

## License

MIT
