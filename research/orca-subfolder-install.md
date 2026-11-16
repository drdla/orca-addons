# Installing an Orca plugin from a subfolder of a multi-plugin repo

Research for [#4](https://github.com/drdla/orca-addons/issues/4) (map [#1](https://github.com/drdla/orca-addons/issues/1)).
Checked against Orca 1.4.259 (`/Applications/Orca.app`), upstream `stablyai/orca` docs, and the
`stablyai/orca-plugins` and `stablyai/orca-community-plugins` catalogs on 2026-11-16.

## Answer

- **Direct installs cannot take a subpath.** `orca plugin install owner/repo[@ref]`, a Git URL, and
  a release, tag or tree page URL all install the **repository root**. A tree URL such as
  `.../tree/main/plugins/foo` does not select a folder. Orca reads everything after `tree/` as the
  ref (`main/plugins/foo`), and that ref does not exist.
- **Catalogs can take a subpath.** A catalog entry's `source.path` names the plugin folder.
  Orca downloads the pinned commit and installs only that folder. This is the supported design
  for "one repository can hold many plugins". Stably's own official catalog works this way: all 43
  plugins live in `stablyai/orca-plugins` under `plugins/<name>`.
- **A local folder works**, as `orca plugin install /abs/path/plugins/<name>`, but its publisher is
  `local` and it never updates by itself. It is a dev and testing route, not for sharing.
- **Tags:** use one repo-wide `vX.Y.Z` tag. Each plugin's own version comes from the `version` in
  its `orca-plugin.json`. Orca and the community directory recognise only `vX.Y.Z` tags, so
  per-plugin tags (`gitlab-review-requests/v1.0.0`) buy nothing. Orca never downloads release
  assets; it always installs from Git.
- **Ways to share `plugins/gitlab-review-requests/`:**
  1. **Make this repo its own catalog.** Add an `orca-catalog.json` at the repo root with
     `source.path` set for each plugin, and paste the output of `orca plugin release-entry`.
     Teammates add `https://github.com/drdla/orca-addons.git` (ref `main`) under Settings →
     Plugins → ⋯ → Catalog sources. They get updates automatically.
  2. **Community catalog:** add the `orca-plugin` topic and push a `vX.Y.Z` tag. In practice the
     community indexer finds manifests in subfolders and mirrors each one with `source.path`
     (see below), but its public instructions still say "manifest at the root". Treat this route
     as working but undocumented.

## Evidence

### 1. Direct install sources ignore subpaths

- `orca plugin install --help` lists these sources: `publisher.id`, `owner/repo[@ref]`, a
  Git URL, "a GitHub or GitLab release, tag or tree page URL", or a folder. It has no
  path or subdirectory option; the only options are `--ref`, `--catalog` and `--approve`.
  With no version, "Orca installs the newest version tag (vX.Y.Z), else the default branch,
  always pinned to the exact commit."
- `out/shared/plugins/installation/plugin-git-install-input.js` (`parsePluginGitInstallInput` /
  `pageRef`) reduces any page URL to `{ url, ref }` only. For GitHub,
  `/owner/repo/tree/<rest...>` becomes `ref = rest.join('/')`. For GitLab,
  `/group/repo/-/tree/<rest...>` does the same. Nothing produces a path.
- `out/main/chunks/orcad-retained-source-*.js`: the Git install path (`cCt`) clones the
  pinned commit into a temp dir and calls the manifest loader with `rootDir` set to that clone.
  The repo root must hold `orca-plugin.json`. Ref resolution (`aCt`/`iCt`) picks the newest
  semver tag and skips pre-releases. An explicit ref must be an exact tag or branch name.
  Otherwise it fails with "has no tag or branch named …".
- `gitInstallSourceInfo` (`plugin-install-source-info.js`) records `path: null` for Git installs.

### 2. Catalogs support `source.path`

- Upstream `docs/reference/plugin-catalog.md`, CatalogGitSource table: `path` (since
  1.4.245) is the "Directory inside the repository that holds `orca-plugin.json`, so one
  repository can publish many plugins … Omit when the plugin is the repository root."
- The same doc, section "One repository can hold many plugins" (also in the app's
  `out/shared/plugins/manifest/plugin-schema-policy-notes.js`): "Give each plugin its own
  directory and set `source.path` to it. Orca downloads the pinned commit but installs only that
  directory, and `contentHash` covers only its files, so a commit that changes a sibling plugin
  leaves this plugin's hash, and its users, untouched. Moving a plugin to another directory counts
  as moving repositories: users review the update before it installs."
- Upstream `docs/reference/plugin-authoring.md` §5, "Publish to a catalog", says the same. It
  adds that each `releases` entry pins a full 40-character `commit` (tags and branch names are
  refused) plus a `contentHash`.
- `orca plugin release-entry <dir>` (implementation:
  `out/main/plugins/plugin-catalog-release-entry.js`) runs `git rev-parse --show-prefix` to
  find the folder's path in the repo. It prints `Catalog source path (set "path" in this plugin's
  "source")` and the release entry for committed `HEAD`. It works offline and reads only committed
  files.
- Legacy clients: `orca-marketplace.json`, the frozen fallback format, must leave out plugins
  with a `source.path`, because older clients would install them from the repo root
  (`plugin-catalog.md`, "Clients before format 2"). We can ignore this, since we need
  `engines.orca >= 1.4.246` anyway.

### 3. How the official and community catalogs work

- **Official** (`stablyai/orca-plugins/orca-catalog.json`): all 43 entries have
  `source = { url: "https://github.com/stablyai/orca-plugins.git", ref: "main",
  path: "plugins/<name>" }`. The official catalog is itself a multi-plugin repo. Listing there
  requires Stably's review (`REVIEW_POLICY.md`, `CONTRIBUTING.md`).
- **Community** (`stablyai/orca-community-plugins`): the catalog is generated, so don't edit it by
  hand. You get listed by adding the `orca-plugin` GitHub topic (README). The page
  `https://orca.dev/plugins/add/` says: "The directory lists your newest `vX.Y.Z` tag, pinned to
  its exact commit and file hash", "Pushes without a new tag change nothing", and "Put
  `orca-plugin.json` (manifest format 2) at the root of a public GitHub repository." It does not
  mention subdirectories.
- **What the community indexer actually does** (from `status.json`, `releases.lock.json` and
  `orca-catalog.json` in that repo):
  - `aamonnaig4/orca-plugins` (topic `orca-plugin`, repo tags `v1.0.0`…`v1.2.0`, plugins under
    `plugins/`) is `listed` with 4 plugins. `miragon/orca-modelers` (repo tags
    `v0.1.0`…`v0.1.29`) is `listed` with 7 plugins.
  - Each plugin is mirrored to `stablyai/orca-community-mirror` with a per-plugin ref and a path.
    Example: `{ url: ".../orca-community-mirror.git", ref:
    "refs/tags/aamonnaig4/orca-plugins/now-playing/1.3.1", path: "plugins/now-playing" }`.
  - Plugin versions are the **manifest** versions (`now-playing` 1.3.1, `oled-pair` 1.0.0), not
    the repo tag. `releases.lock.json` records each `<id>@<version>` with its commit and
    content hash the first time it is seen, and that record never changes after that. So when you
    bump one plugin's `version` and push a new repo tag, only that plugin gets a new release.
  - Other repos in `status.json` show discovered paths `orca-plugin` and `plugin`. So discovery
    is not limited to `plugins/*`.
  - Caveat: `Miragon/orca-plugins`, renamed from `orca-modelers`, is on `identity-hold`. Renaming
    or transferring the repo pauses new versions until Stably confirms the move.
    `plugin-catalog.md` ("Listed names are pinned to GitHub ids") says the same.

### 4. Community repos with several plugins

| Repo | Layout | Tags | Distribution |
| --- | --- | --- | --- |
| `aamonnaig4/orca-plugins` | `plugins/<name>/` + root `orca-catalog.json` | repo-wide `v1.x.y` | Own catalog (README: add the repo URL, ref `main`, as a catalog source) **and** the community catalog via topic |
| `Miragon/orca-plugins` (formerly `orca-modelers`) | `plugins/<name>/` + root `orca-catalog.json` | repo-wide `v0.1.x` | Same pattern |
| `stablyai/orca-plugins` | `plugins/<name>/` | none; releases pinned by commit | Official catalog |

The `aamonnaig4/orca-plugins` README gives this workflow for adding or updating a plugin:
`orca plugin create plugins/<name>`, then commit, then
`orca plugin release-entry plugins/<name>`, then add the printed release to `orca-catalog.json`
with `source.path` set, then `orca plugin validate orca-catalog.json`, then push. To update,
"raise its `version` and repeat … List the newest release first."

## Recommended scheme for `drdla/orca-addons`

1. Keep each plugin in `plugins/<name>/` with its own `orca-plugin.json` `version`. Set
   `engines.orca` to at least `>=1.4.246`, because `source.path` needs `>=1.4.245`.
2. Add a root `orca-catalog.json` (`catalogVersion: 2`) with one entry per plugin:
   `id: "drdla.<manifest id>"`, and `source: { kind: "git", url:
   "https://github.com/drdla/orca-addons.git", ref: "main", path: "plugins/<name>" }`.
   Releases come from `orca plugin release-entry plugins/<name> --json`, newest first. Check it
   with `orca plugin validate orca-catalog.json`.
3. To release: bump the plugin's `version` and commit. Paste the release entry into
   `orca-catalog.json` and commit. Then optionally push a repo-wide `vX.Y.Z` tag, which the
   community directory needs. Don't create per-plugin tags or release assets.
4. Teammates add the repo as a catalog source, or use an install link:
   `https://orca.dev/plugins/drdla.gitlab-review-requests?catalog=https://github.com/drdla/orca-addons.git`.
   Catalog plugins with pinned releases update automatically, after a 12-hour hold for
   non-official catalogs (`plugin-authoring.md` §5).
5. The community listing (topic `orca-plugin`) is optional. It works for subfolders in practice,
   but the public docs don't promise that. The plugin also gets "checked by machine, not read by
   a person" and is public.

## Open points

- The community indexer's rules for finding subfolders (depth, ignored folders) are not
  published. The behaviour above is observed in its output, not documented.
- I did not run `orca plugin install drdla/orca-addons` against a repo with no root manifest
  (no installs allowed in this research). From the code, it fails at manifest loading.
