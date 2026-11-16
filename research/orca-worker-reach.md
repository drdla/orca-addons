# What can an Orca plugin worker reach?

Research for [#2](https://github.com/drdla/orca-addons/issues/2) (map [#1](https://github.com/drdla/orca-addons/issues/1)).
Target: Orca 1.4.259, host API 1.9, a `trusted-worker` plugin from the `worker-panel` template.

## Summary

| Question | Answer |
| --- | --- |
| Outbound HTTPS | **Yes, unrestricted.** The worker is a plain Node 24 child process with no sandbox, no permission model and no network policy. `fetch` and `node:https` both reached gitlab.com. The "no network" rule applies to **panels** only. |
| Spawn `glab` | **Yes.** `node:child_process` works without any capability. `glab` in `/opt/homebrew/bin` is found even when Orca starts from the Dock, because Orca seeds Homebrew and other common folders into `PATH` at startup. |
| Secrets, settings, storage | All three work from the worker. Each needs its capability (`secrets:own`, `settings:own`, `storage:own`). Limits: 1,024 keys, 256 KiB per storage value, 5 MiB per file. Secrets are encrypted with the macOS keychain. Settings are plain JSON, so a token must go in `secrets`. |
| Approval fingerprint | Needed on the first install of any code plugin. The user approves in Orca, or runs the CLI with `--approve <fingerprint>`. An update from the same repository **keeps** its approval when it asks for no new access, code changes included. New capabilities, contributions or execution level need a new approval. |
| Spawn the `orca` CLI | **Yes.** The launcher sets `ELECTRON_RUN_AS_NODE=1` itself, so the inherited value does no harm. `worktree list --json` and `plugin list --json` worked with the worker's environment. Call it by absolute path (`/Applications/Orca.app/Contents/Resources/bin/orca`): the `/usr/local/bin/orca` symlink may not exist on teammates' machines. |
| Session-long timer, sleep/wake | **Yes, if the plugin declares a status bar item.** A `main` plus `statusBarItems` makes the worker resident: it starts when the plugin is enabled and is never reaped as idle. Timers pause while the Mac sleeps. Orca sends no wake event, so the worker must check wall-clock time to notice a wake. |

## 1. Outbound HTTPS

- The worker is forked with `child_process.fork(entry, [], { env: buildPluginWorkerEnv(), execArgv: [], serialization: 'advanced', stdio: [...,'ipc'] })` and runs as Node (`ELECTRON_RUN_AS_NODE=1`). It gets no `--permission` flag or other `execArgv`, so Node's full standard library is available. Sources: upstream [`src/main/plugins/workers/parent-process/plugin-host-process.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/main/plugins/workers/parent-process/plugin-host-process.ts) and the matching compiled code in `/Applications/Orca.app/Contents/Resources/app.asar`. The child-side entry is `/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/main/plugin-host-entry.js`; it only installs a TypeScript loader and IPC.
- Orca's approval text for `trusted-worker` says so directly: *"Runs its own code in a separate Node.js process on the Orca host, with your user account's access to that machine."* (`orca plugin dev load` output, `grants.executionDescription`).
- None of the 15 capabilities gates network or process access ([host-api reference](#sources), "Capabilities"). Capabilities only gate `orca.host.call` methods.
- The skill's gotcha *"No network: requests outside the plugin's files fail"* applies to **panels and frames**, which are sandboxed. It does not apply to the worker. When a panel needs data, it asks the worker with `plugin.request`.
- **Empirical check.** I ran a probe script with Orca's own runtime (`Orca Helper` + `ELECTRON_RUN_AS_NODE=1`, Node 24.22.1, Electron 43.8.7) and the worker's environment allowlist. Results: `fetch('https://gitlab.com/api/v4/version')` → `HTTP 401`; `https.request` → `HTTP 401`; `process.permission` is absent. A 401 is the expected unauthenticated answer and proves the server was reached.
- **Self-hosted GitLab, caveats:**
  - **Private CA.** Node uses its bundled CA list, not the macOS keychain. `NODE_EXTRA_CA_CERTS` is stripped from the worker env (see §2), and `--use-system-ca` cannot be passed because `execArgv` is empty. Workaround in code: `tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])`. Both functions exist in Orca's Node (checked). Going through `glab` avoids the problem, because its Go TLS stack uses the system roots.
  - **Proxies.** `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` are stripped too. Neither `fetch` nor a spawned `glab` will see a proxy unless the plugin passes one in itself, for example from a setting.

## 2. Spawning `glab`, and `PATH` when Orca starts from the Dock

- `node:child_process` (`execFile`, `spawn`) works and needs no capability. The probe ran `glab --version` → `glab 1.119.0`, and `glab auth status` succeeded for `gitlab.com`.
- **Worker environment allowlist** (upstream [`plugin-worker-env.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/main/plugins/workers/parent-process/plugin-worker-env.ts), identical in the installed bundle): `PATH, HOME, USERPROFILE, LANG, LC_ALL, LC_CTYPE, TZ, TMPDIR, TEMP, TMP` plus Windows-only keys, and `ELECTRON_RUN_AS_NODE=1`. Everything else is dropped "to exclude shell/CI credentials from third-party code". For this plugin that means:
  - `GITLAB_TOKEN`, `GITLAB_HOST`, `GLAB_*`, `XDG_CONFIG_HOME` and the proxy variables never reach the worker or `glab`. `glab` must rely on its config file under `HOME`, which is the normal `glab auth login` setup. A user who keeps glab's config under a custom `XDG_CONFIG_HOME` would need the plugin to pass it explicitly.
  - Anything `glab` needs from the environment, the plugin must set in `execFile(..., { env: {...process.env, ...} })`.
- **`PATH` when Orca is launched from the Dock.** Launchd gives the app `PATH=/usr/bin:/bin:/usr/sbin:/sbin`; that is what the running Orca's own process shows. Orca then fixes it in two steps, both in the main process before or around worker forks:
  1. **Synchronous seed at startup** (`zXn()` in the bundle; upstream `main-process-preflight.ts`, packaged builds only). It appends `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, `/usr/local/sbin`, `/nix/var/nix/profiles/default/bin`, `/usr/bin`, `/bin`, `~/bin`, `~/.local/bin`, `~/.nix-profile/bin` and a few others, plus Node version-manager folders (nvm, volta, asdf, fnm, mise, pnpm, yarn, bun).
  2. **Async login-shell probe.** It runs `$SHELL -ilc 'printf … "$PATH"'` (upstream [`shell-path-probe.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/main/startup/shell-environment/shell-path-probe.ts), [`hydrate-shell-path.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/main/startup/shell-environment/hydrate-shell-path.ts)) and merges the shell's `PATH` in front of the seeded one. It is time-boxed, and on failure it logs `[shell-path] login-shell probe failed …; using seeded PATH`.
- A worker inherits `process.env.PATH` **as it is at fork time**. **Observed on this machine:** Orca started from the Dock, and a live plugin worker (`plugin-host-entry.js`) forked 5 s after launch had only the **seeded** `PATH`, without login-shell entries such as `~/.cargo/bin` or `~/.pyenv/shims`. Its environment was exactly `PATH, HOME, TMPDIR, ELECTRON_RUN_AS_NODE` plus Node's IPC variables. Children forked later had the merged login-shell `PATH`. With the seeded `PATH` (`/opt/homebrew/bin` included) the probe found `glab`. With the bare launchd `PATH` it got `ENOENT`.
- **Verdict:** a Homebrew `glab` (`/opt/homebrew/bin` or `/usr/local/bin`) is found in every case. A `glab` installed somewhere only the user's shell rc adds to `PATH` may be missing in a worker that starts early, because resident workers start at launch. Mitigations: offer a "glab path" setting; fall back to probing `/opt/homebrew/bin/glab`, `/usr/local/bin/glab` and `~/.local/bin/glab`; report `ENOENT` as a clear "glab not found" state.

## 3. Secrets, settings, storage

All three are on the worker API (`orca.secrets`, `orca.settings`, `orca.storage`) and on panels. Every surface shares one store per plugin, and `onDidChange` fires on all surfaces ([recipes reference](#sources), "Storage, settings and secrets").

| API | Capability | Where | Limits / notes |
| --- | --- | --- | --- |
| `storage.get/set/delete/keys` | `storage:own` | `<userData>/…/plugins data/<pluginKey>/storage.json` (upstream `plugin-storage-store.ts`) | JSON values; **256 KiB per value, 1,024 keys, 5 MiB file** (`PLUGIN_STORAGE_VALUE_MAX_BYTES`, `PLUGIN_STORAGE_KEY_LIMIT`, `PLUGIN_STORAGE_TOTAL_MAX_BYTES` in the installed bundle). It survives worker restarts and saves; this is the place to cache the last-seen Review Request list. |
| `secrets.get/set/delete`, `secrets.protection` | `secrets:own` | `secrets.json.enc` in the same folder, each value encrypted with Electron `safeStorage`, which uses the macOS keychain (upstream `plugin-secrets-store.ts`) | String values; **1,024 keys, 5 MiB file**. `secrets.protection()` returns `os-keyring` or `unavailable`. When it is `unavailable` (no keychain, or a locked or headless session), `secrets.set` fails. Check it and show the state. |
| `settings.get/set`, Settings UI | `settings:own` | `settings.json` in the same folder | At most **64** declared settings, of type `string \| number \| integer \| boolean`, with `enum`, `minimum`/`maximum`, `maxLength`, `multiline` and `placeholder` ([manifest reference](#sources), SettingContribution). Orca validates the person's edits against the declaration. Stored **in plain text**, and there is no password type, so a PAT belongs in `secrets`, entered through the panel. |

Other relevant limits: panel ↔ worker answers are at most 1 MiB, `panels.post` at most 256 KiB and 200 posts per 10 s, and `plugin.request` times out after 30 s by default (120 s max) ([recipes reference](#sources)). Host calls may fail with `rate_limited` and a `retryAfterMs` ([host-api reference](#sources), Errors).

## 4. Approval fingerprint on install and update

- **Every code plugin needs approval.** A plugin with `main` or panels, a capability or a command needs it. Loading or installing returns `approval_required` (exit 3) with a fingerprint and the list of grants. The user approves in Orca's UI, or runs the same command again with `--approve <fingerprint>`. The plugin system must also be on (`plugin_system_disabled` otherwise; Settings → Plugins → "Turn on plugins"). An agent must not approve on the user's behalf ([skill](#sources), "Approval").
- **What the fingerprint covers** (upstream [`plugin-consent-fingerprint.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/shared/plugins/approval/plugin-consent-fingerprint.ts)): the sorted capability set, the `execution` profile, whether there is a Node worker (`main`), any `replaces` takeovers, and, for anything at `sandboxed-ui` or above, a **content identity**. For an install the content identity is the package's content hash. For a development folder it is `dev:<absolute folder path>`.
- **Development folder** (`orca plugin dev load|watch`). Real output from loading a throwaway probe: *"Later code edits in this development folder run without asking again; new access, a higher execution level, or changed commands and shortcuts need a new approval."* Fingerprint format: `ap1-<hex>`.
- **First install** (Git URL or catalog): approval is bound to the exact bytes; the review shows execution, capabilities and contributions.
- **Update** (upstream [`plugin-update-approval.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/main/plugins/catalog/plugin-update-approval.ts), `plugin-cli-install.ts`, [`plugin-update-access-growth.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/shared/plugins/approval/plugin-update-access-growth.ts)). The rule is "trust once per access level". An update from the **same repository** that asks for no new access **keeps the approval, code changes included**. That holds for the UI Update button, catalog auto-update and `orca plugin update` (result `approval: 'kept'`). A new review is needed when:
  - capabilities are added,
  - the execution profile rises,
  - authority-bearing contributions grow (a new panel id, command, shortcut, event, hook or status bar item, or a custom editor reaching more files),
  - or the repository moved.
  An update waiting for review stays installed but does not run until it is approved.
- **Implication for this plugin:** declare every capability and contribution that v1 will need up front (`storage:own`, `secrets:own`, `settings:own`, `notifications:show`, `workspace:read`, and probably `workspace:write` for removing a workspace, the status bar item, commands and panel). Teammates then approve once, and later releases update silently.

## 5. Session-long timer and sleep/wake

- **Default lifetime.** A worker starts on demand (a command, an event or `plugin.request`). It is **reaped after 5 min idle**: sweeps run every 60 s, and a worker counts as idle with nothing in flight (`PLUGIN_WORKER_IDLE_REAP_MS = 5*60_000`, `PLUGIN_WORKER_REAP_INTERVAL_MS = 60_000` in upstream [`plugin-host-protocol.ts`](https://github.com/stablyai/orca/blob/v1.4.259/src/shared/plugins/workers/plugin-host-protocol.ts)). A plain `setInterval` in such a worker dies with it.
- **Resident worker.** If the manifest has `main` **and** at least one `contributes.statusBarItems` entry (or a hook), the worker is `keepWarm`. It starts as soon as the plugin is enabled and approved, at Orca launch, and the idle reaper skips it (upstream `plugin-resident-worker.ts`, `plugin-worker-idle-clock.ts`). The docs agree: *"A plugin with `main` and status bar items has its worker started when it is enabled and kept running while it stays enabled, so a worker can poll and update its items without an event or a hook."* ([host-api reference](#sources), `statusBar.update`; [manifest reference](#sources), `statusBarItems`). The status-bar count already settled for #1 therefore gives us a session-long poller at no extra cost. Resident workers sit outside the 5-active-worker cap; the soft cap is 16 resident workers.
- **Crashes.** An uncaught exception or unhandled rejection exits the worker (`plugin-host-entry.js`). The supervisor restarts it **at most 3 times** (backoff 0.5 s, 2 s, 5 s; the count resets after a successful start). After that it is marked errored and **stays down until the plugin changes** (re-enable, update or reload). The poll loop must catch every error.
- **Restarts lose memory.** A dev save, an update, a re-enable or a crash restart drops in-memory state. Keep the last-known Review Request set in `orca.storage` so "new" and "ended" diffs survive restarts and do not re-notify.
- **`statusBar.update`** state lasts until Orca restarts. The worker should set the item again in `activate`.
- **Sleep and wake.** Workers are ordinary processes, and their timers stop while the Mac sleeps. Orca's own idle clock says so: *"a sweep gap well past the interval means the machine slept, and worker timers slept with it"* (`plugin-worker-idle-clock.ts`). No worker event reports sleep or wake: the event list has only workspace, agent and editor-typography events ([events reference](#sources)), and Electron `powerMonitor` cannot be reached from a Node child. On macOS a pending `setTimeout` may fire up to one full interval after wake, because libuv's monotonic clock does not advance during sleep. Recommended pattern:
  - a short tick (e.g. every 30 s) that polls when `Date.now() - lastPollAt >= interval`, so a wake triggers a refresh within one tick;
  - after a gap much longer than the tick, treat it as a wake: expect the network to be down for a few seconds, and retry with backoff before showing an error state.
  Also observed: Orca was running `caffeinate -i -s -w <orca-pid>`, which keeps the Mac awake while Orca runs. That looks like an Orca keep-awake feature; do not rely on it.

## 6. Spawning the `orca` CLI from the worker

Research #3 found three actions that only the CLI can do: reading workspace↔MR links (`orca worktree list --json`), removing a workspace (`orca worktree rm`) and opening a panel (`orca plugin open <key> --panel <id>`).

- **It works.** `/Applications/Orca.app/Contents/Resources/bin/orca` is a bash launcher whose last line is `ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$CLI" "$@"`. It sets the variable itself, so the `ELECTRON_RUN_AS_NODE=1` that the worker env passes on to children does no harm. The launcher also unsets `NODE_OPTIONS`.
- **Empirical check.** The probe ran under Orca's runtime with the worker env allowlist (`PATH` seeded, `HOME`, `TMPDIR`, `ELECTRON_RUN_AS_NODE=1`). Results: `orca --version` → `1.4.259`; `orca worktree list --json` → `ok: true` with the full list (13 KB); `orca plugin list --json` → `ok: true`. Only `HOME` was needed to reach the running Orca. Mutating commands (`worktree rm`, `plugin open`) were not run.
- **`PATH`.** A bare `orca` resolved here only because `/usr/local/bin/orca` is a symlink to the app's launcher; Orca's "install CLI" step probably created it. A teammate may not have that link. **Use the absolute path** `/Applications/Orca.app/Contents/Resources/bin/orca`, then fall back to `orca` on `PATH`. A setting can override the path for non-standard installs.
- **Caveats:**
  - The CLI is **not capability-gated.** It acts with the user's full authority over Orca, outside the plugin's approved capability list. The approval prompt for `trusted-worker` ("…with your user account's access…") does cover it, but teammates would not see "removes workspaces" listed. State it in the README and confirm each `worktree rm` in the panel.
  - Each call starts a fresh Electron process in Node mode (latency not measured). That is fine for occasional actions; avoid it on every poll tick. Prefer the host API where it exists: `workspace.list` (`workspace:read`) gives ids, paths and branches without the CLI.
  - The CLI's JSON output is an external contract that can change between Orca versions. Parse it defensively and branch on `error.code`.
- **Verdict:** a worker can spawn the `orca` CLI and use it for the three CLI-only actions. Call it by absolute path and validate the output.

## Not verified / open

- **No end-to-end run inside the real Orca host.** `orca plugin dev load` of a throwaway probe returned `approval_required`, and per the ticket I did not approve it on the user's behalf. I then unloaded it, so no plugin or setting was left behind. Network, `glab` and `PATH` behaviour were checked by (a) reading the shipped code and upstream source at `v1.4.259`, (b) running the probe under Orca's own Node runtime with the worker's environment allowlist and the seeded `PATH`, and (c) reading the environment of a live plugin worker process. A one-off approved run of the probe would confirm the same results inside Orca.
- Whether `settings.set` from code may write **undeclared** keys was not checked. The Settings UI writer accepts declared keys only.
- `glab`'s keyring-backed token storage (`glab auth login --use-keyring`) was not tested from a worker. The worker runs as the user, so keychain access should behave as it does from a terminal.

## Sources

- Skill: `orca skills get orca-plugin-authoring`, plus `--reference references/{host-api,recipes,manifest,events,cli,workflow,testing}.md` (generated from Orca 1.4.259).
- Typings: `/Applications/Orca.app/Contents/Resources/plugins/types/orca-worker.d.ts` and the others in that folder.
- Shipped code: `/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/main/plugin-host-entry.js`; `app.asar` (functions `IDi` = worker env, `GDi` = fork, `zXn` = PATH seed, the startup call to the login-shell probe).
- Upstream source at tag [`v1.4.259`](https://github.com/stablyai/orca/tree/v1.4.259): `src/main/plugins/workers/**`, `src/main/plugins/plugin-{secrets,storage}-store.ts`, `src/main/plugins/plugin-declared-settings.ts`, `src/main/plugins/catalog/plugin-update-approval.ts`, `src/main/plugins/cli/plugin-cli-*.ts`, `src/shared/plugins/approval/*`, `src/shared/plugins/workers/plugin-host-protocol.ts`, `src/main/startup/shell-environment/*`.
- Empirical: `orca plugin create … --template worker-panel` + `orca plugin dev load` (approval payload only, then `dev unload`); a probe script under `Orca Helper` with `ELECTRON_RUN_AS_NODE=1`; `ps eww` on the running Orca and its plugin worker.
