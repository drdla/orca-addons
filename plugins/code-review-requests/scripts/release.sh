#!/usr/bin/env bash
# Releases Code Review Requests to the repo's own catalog (orca-catalog.json at the repo root).
# Run it on a clean branch after committing the plugin with its new "version":
#
#   plugins/code-review-requests/scripts/release.sh [--no-smoke] [--push]
#
# It checks the plugin (validate, tsc, test, check, the read-only smoke), writes the release entry
# for the committed HEAD into orca-catalog.json (replacing a release of the same version), validates
# the catalog and commits it. The release pins HEAD, the plugin commit, so merge the branch with a
# merge commit: a squash or rebase merge leaves the pinned commit off main.
#
#   --no-smoke  skip `npm run smoke` (for machines without glab or a GitLab login)
#   --push      push the branch afterwards (refused on main/master)
set -euo pipefail

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }
fail() { printf '\nrelease: %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

smoke=1
push=0
for arg in "$@"; do
  case "$arg" in
    --no-smoke) smoke=0 ;;
    --push) push=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; fail "unknown option: $arg" ;;
  esac
done

plugin_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(git -C "$plugin_dir" rev-parse --show-toplevel)"
catalog="$repo/orca-catalog.json"
cd "$plugin_dir"

for tool in orca node npm git; do
  command -v "$tool" >/dev/null || fail "$tool is not on PATH"
done
[ -f "$catalog" ] || fail "no orca-catalog.json at the repo root ($repo)"

step 'Working tree'
[ -z "$(git -C "$repo" status --porcelain)" ] || fail 'the working tree has uncommitted changes; commit or stash them first'
# Orca refuses to install a folder holding a symlink ("unsafe file path or symlink").
[ ! -e node_modules ] || fail "$plugin_dir/node_modules exists; delete it (this script type-checks without it)"
links="$(find . -type l)"
[ -z "$links" ] || fail "symlinks in the plugin folder; remove them: $links"
echo 'clean, no node_modules, no symlinks'

tmp_created="$(mktemp -d)"
trap 'rm -rf "$tmp_created"' EXIT
# The physical path: npm ci --prefix misreads a path through a symlink (macOS /var -> /private/var).
tmp="$(cd "$tmp_created" && pwd -P)"

step 'orca plugin validate'
orca plugin validate . || fail 'the plugin is invalid'

step 'Type-check (TypeScript and Node typings installed in a temporary folder)'
orca plugin types . >/dev/null
cp package.json package-lock.json "$tmp/"
npm ci --prefix "$tmp" --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null ||
  fail "npm ci couldn't install TypeScript and the Node typings"
"$tmp/node_modules/.bin/tsc" -p . --typeRoots "./.orca/types,$tmp/node_modules/@types" || fail 'tsc found type errors'
echo 'tsc: no errors'

step 'orca plugin test'
# The suite takes seconds; one that runs longer hangs (a test left timers running), so stop it.
TEST_TIMEOUT_S=180
test_status=0
perl -e 'alarm shift; exec @ARGV' "$TEST_TIMEOUT_S" orca plugin test . >"$tmp/test.log" 2>&1 || test_status=$?
grep -E '^ℹ (tests|pass|fail)|^✖|test file' "$tmp/test.log" || true
# 142: killed by the alarm (128 + SIGALRM).
[ "$test_status" != 142 ] || fail "orca plugin test hung for ${TEST_TIMEOUT_S}s; run \`orca plugin test .\` to see which test file doesn't finish"
[ "$test_status" = 0 ] || fail 'orca plugin test failed; run `orca plugin test .` for the details'

step 'orca plugin check'
orca plugin check . || fail 'orca plugin check failed'

if [ "$smoke" = 1 ]; then
  step 'Read-only smoke against your GitLab and Orca (skip with --no-smoke)'
  npm run --silent smoke || fail 'the read-only smoke failed (or run with --no-smoke on a machine without glab)'
else
  step 'Read-only smoke skipped (--no-smoke)'
fi

step 'Release entry for the committed HEAD'
orca plugin release-entry . --json >"$tmp/entry.json" || fail 'orca plugin release-entry failed'
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/resolve-ts.mjs \
  src/release/main.ts "$catalog" "$tmp/entry.json" || fail "couldn't merge the release into orca-catalog.json"
orca plugin validate "$catalog" || fail 'orca-catalog.json is invalid; see above (git checkout orca-catalog.json undoes the merge)'

version="$(node -p 'require("./orca-plugin.json").version')"
commit="$(git rev-parse HEAD)"
if git -C "$repo" diff --quiet -- "$catalog"; then
  echo "orca-catalog.json already lists $version at $commit; nothing to commit"
else
  step 'Commit'
  git -C "$repo" add -- "$catalog"
  git -C "$repo" commit -q -m "Release Code Review Requests $version to orca-catalog.json" \
    -m "Pins $commit."
  git -C "$repo" log --oneline -1
fi

[ -z "$(find . -type l)" ] || fail 'a symlink appeared in the plugin folder during the release'

branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
if [ "$push" = 1 ]; then
  case "$branch" in main | master | HEAD) fail "won't push $branch; push a release branch and open a PR" ;; esac
  step "Push $branch"
  git -C "$repo" push -u origin "$branch"
else
  printf '\nNot pushed. To publish: git push -u origin %s, then merge the PR with a merge commit.\n' "$branch"
fi
