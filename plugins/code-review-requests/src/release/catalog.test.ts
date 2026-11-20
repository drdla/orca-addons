// The catalog merge behind scripts/release.sh: an `orca plugin release-entry --json` result goes
// into orca-catalog.json as text, so the diff shows only the release that changed.
import { assert, test } from 'orca/testing'
import { mergeRelease } from './catalog'

const CATALOG = `{
  "$schema": "https://example.com/orca-catalog.v2.schema.json",
  "catalogVersion": 2,
  "name": "orca-addons",
  "owner": "acme",
  "plugins": [
    {
      "id": "acme.code-review-requests",
      "source": {
        "kind": "git",
        "url": "https://github.com/acme/orca-addons.git",
        "ref": "main",
        "path": "plugins/code-review-requests"
      },
      "description": "Review Requests in Orca.",
      "categories": ["productivity"],
      "releases": [
        {
          "version": "0.1.0",
          "commit": "1111111111111111111111111111111111111111",
          "contentHash": "aaaa",
          "execution": "trusted-worker",
          "minimumOrca": "1.4.259",
          "name": "Code Review Requests",
          "contributes": [{ "kind": "panels", "name": "Review Requests" }],
          "capabilities": ["storage:own"]
        }
      ]
    },
    {
      "id": "acme.linear-board-sync",
      "source": {
        "kind": "git",
        "url": "https://github.com/acme/orca-addons.git",
        "ref": "main",
        "path": "plugins/linear-board-sync"
      },
      "categories": ["productivity"],
      "releases": [
        {
          "version": "0.4.0",
          "commit": "2222222222222222222222222222222222222222",
          "contentHash": "bbbb",
          "execution": "trusted-worker",
          "minimumOrca": "1.4.259",
          "name": "Linear Board Sync",
          "contributes": [
            { "kind": "commands", "name": "Linear Board Sync: Sync now" },
            { "kind": "events", "name": "workspace.created" }
          ],
          "capabilities": ["storage:own", "settings:own", "workspace:read", "notifications:show"]
        }
      ]
    }
  ]
}
`

function result(version: string, commit = '3333333333333333333333333333333333333333') {
  return {
    pluginKey: 'local.code-review-requests',
    sourcePath: 'plugins/code-review-requests',
    entry: {
      version,
      commit,
      contentHash: 'cccc',
      execution: 'trusted-worker',
      minimumOrca: '1.4.259',
      name: 'Code Review Requests',
      contributes: [{ kind: 'panels', name: 'Review Requests' }],
      capabilities: ['storage:own', 'settings:own']
    }
  }
}

const NEW_RELEASE = `        {
          "version": "VERSION",
          "commit": "3333333333333333333333333333333333333333",
          "contentHash": "cccc",
          "execution": "trusted-worker",
          "minimumOrca": "1.4.259",
          "name": "Code Review Requests",
          "contributes": [{ "kind": "panels", "name": "Review Requests" }],
          "capabilities": ["storage:own", "settings:own"]
        }`

test('a release of an existing version replaces that release; the rest of the file is unchanged', () => {
  const { text, replaced } = mergeRelease(CATALOG, result('0.1.0'))

  const oldRelease = CATALOG.slice(CATALOG.indexOf('        {\n          "version": "0.1.0"'), CATALOG.indexOf('\n      ]\n    },'))
  assert.equal(text, CATALOG.replace(oldRelease, NEW_RELEASE.replace('VERSION', '0.1.0')))
  assert.equal(replaced?.commit, '1111111111111111111111111111111111111111')
})

test('a newer version goes first and the older releases stay listed', () => {
  const { text, replaced } = mergeRelease(CATALOG, result('0.2.0'))

  const at = CATALOG.indexOf('        {\n          "version": "0.1.0"')
  assert.equal(text, `${CATALOG.slice(0, at)}${NEW_RELEASE.replace('VERSION', '0.2.0')},\n${CATALOG.slice(at)}`)
  assert.equal(replaced, null)
})

test('re-running on a later commit with the same files keeps the release pinned where it was', () => {
  const unchanged = { ...result('0.1.0', '4444444444444444444444444444444444444444'), entry: { ...result('0.1.0').entry, contentHash: 'aaaa' } }

  const { text, replaced } = mergeRelease(CATALOG, unchanged)

  assert.equal(text, CATALOG)
  assert.equal(replaced?.commit, '1111111111111111111111111111111111111111')
})

test('a list too long for one line is printed one item per line', () => {
  const capabilities = ['storage:own', 'settings:own', 'secrets:own', 'notifications:show', 'workspace:read', 'workspace:write', 'agent:launch']
  const long = { ...result('0.2.0'), entry: { ...result('0.2.0').entry, capabilities } }

  const { text } = mergeRelease(CATALOG, long)

  assert.match(text, /"capabilities": \[\n {12}"storage:own",\n {12}"settings:own",\n[^\]]*\n {12}"agent:launch"\n {10}\]/)
})

test('refuses a version older than the newest release listed, which Orca would never offer', () => {
  assert.throws(() => mergeRelease(CATALOG, result('0.0.9')), /0\.0\.9 is older than 0\.1\.0/)
})

test('refuses a plugin folder the catalog has no entry for', () => {
  const other = { ...result('0.2.0'), sourcePath: 'plugins/elsewhere' }
  assert.throws(() => mergeRelease(CATALOG, other), /no plugin with "source\.path": "plugins\/elsewhere"/)
})

test("refuses when the catalog entry's id names another plugin", () => {
  const other = { ...result('0.2.0'), pluginKey: 'local.something-else' }
  assert.throws(() => mergeRelease(CATALOG, other), /acme\.code-review-requests is not something-else/)
})
