// The live smoke script's read-only checks (#31), run here against the fakes and the sanitized
// captures: glab's logins, the Review Requests and approvals queries through the plugin's own
// modules, and the `orca` CLI JSON the plugin reads. Nothing here writes, live or fake.
import { assert, test } from 'orca/testing'
import { FakeGitLab } from '../fakes'
import type { FakeGitLabOptions } from '../fakes/fake-gitlab'
import { worktreeListEnvelope } from '../fixtures/orca-cli-captures'
import { worktreePsEnvelope } from '../fixtures/orca-cli-ps-capture'
import type { RunOrca } from '../orca-cli-process'
import { GitLabError } from '../seams/gitlab'
import { formatReport, runReadOnlyChecks, type Check, type ReadOnlyDeps } from './read-only-checks'

const GLAB = '/opt/homebrew/bin/glab'
const AUTH_STATUS = `gitlab.example.com
  ✓ Logged in to gitlab.example.com as me (/Users/me/.config/glab-cli/config.yml)
  ✓ Token found: **************************
`

type Arranged = { gitlab: FakeGitLab; deps: ReadOnlyDeps; orcaCalls: string[][] }

function arrange(options: { gitlab?: FakeGitLabOptions; orca?: Record<string, unknown> } = {}): Arranged {
  const gitlab = new FakeGitLab(options.gitlab)
  gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 7, approvalsRequired: 2 })
  gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 3 })
  const orcaCalls: string[][] = []
  const envelopes: Record<string, unknown> = {
    list: worktreeListEnvelope,
    ps: worktreePsEnvelope,
    ...options.orca
  }
  const runOrca: RunOrca = async (args) => {
    orcaCalls.push(args)
    return { exitCode: 0, stdout: JSON.stringify(envelopes[args[1]!]), stderr: '' }
  }
  const deps: ReadOnlyDeps = {
    locateGlab: () => GLAB,
    glabAuthStatus: async () => AUTH_STATUS,
    gitLab: () => gitlab,
    runOrca
  }
  return { gitlab, deps, orcaCalls }
}

function byName(checks: Check[]): Record<string, Check> {
  return Object.fromEntries(checks.map((c) => [c.name, c]))
}

test('a healthy setup passes every check, and the report says so', async () => {
  const { deps, gitlab, orcaCalls } = arrange()
  const checks = await runReadOnlyChecks(deps, { host: null })

  assert.deepEqual(
    checks.map((c) => [c.name, c.status]),
    [
      ['glab found', 'pass'],
      ['glab auth status', 'pass'],
      ['GitLab version', 'pass'],
      ['Current user', 'pass'],
      ['Review Requests query', 'pass'],
      ['Review Requests response shape', 'pass'],
      ['Reviewers (requested at)', 'pass'],
      ['Approvals query (optional)', 'pass'],
      ['orca worktree list --json', 'pass'],
      ['orca worktree ps --json', 'pass']
    ]
  )
  const named = byName(checks)
  assert.match(named['glab auth status']!.detail, /gitlab\.example\.com/)
  assert.match(named['Review Requests query']!.detail, /2 Review Requests/)
  assert.match(named['Approvals query (optional)']!.detail, /1 with required approvals/)
  // Read-only: no REST call other than GET, and only the two read-only orca commands.
  assert.deepEqual(gitlab.requests.filter((r) => /^(POST|PUT|DELETE) /.test(r.operation)), [])
  assert.deepEqual(orcaCalls.map((a) => a.slice(0, 2).join(' ')), ['worktree list', 'worktree ps'])

  const report = formatReport(checks)
  assert.match(report, /PASS {2}glab found/)
  assert.match(report, /10 passed, 0 failed/)
})

test('a GitLab without the EE approval fields only warns: the list does not need them', async () => {
  const { deps } = arrange({ gitlab: { edition: 'ce' } })
  const named = byName(await runReadOnlyChecks(deps, { host: null }))
  assert.equal(named['Review Requests query']!.status, 'pass')
  assert.equal(named['Approvals query (optional)']!.status, 'warn')
  assert.match(named['Approvals query (optional)']!.detail, /approvalsRequired/)
})

test('without glab the GitLab checks are skipped, and the orca checks still run', async () => {
  const { deps } = arrange()
  const checks = await runReadOnlyChecks({ ...deps, locateGlab: () => null }, { host: null })
  const named = byName(checks)
  assert.equal(named['glab found']!.status, 'fail')
  assert.equal(named['Review Requests query']!.status, 'skip')
  assert.equal(named['orca worktree ps --json']!.status, 'pass')
  assert.match(formatReport(checks), /1 failed/)
})

test('a host glab is not logged in to fails the login check', async () => {
  const { deps } = arrange()
  const named = byName(await runReadOnlyChecks(deps, { host: 'gitlab.other.org' }))
  assert.equal(named['glab auth status']!.status, 'fail')
  assert.match(named['glab auth status']!.detail, /not logged in to gitlab\.other\.org/)
  assert.equal(named['Current user']!.status, 'skip')
})

test('a GitLab older than 17.4 fails the Review Requests query with the reason', async () => {
  const { deps, gitlab } = arrange({ gitlab: { version: '17.3.2' } })
  // As an old GitLab answers the query: the `not` argument is unknown.
  const graphql = gitlab.graphql.bind(gitlab)
  gitlab.graphql = async (query, variables) => {
    if (query.includes('not: {')) throw new GitLabError('rejected', "Field 'not' doesn't exist", { status: 200 })
    return graphql(query, variables)
  }
  const named = byName(await runReadOnlyChecks(deps, { host: null }))
  assert.equal(named['GitLab version']!.status, 'fail')
  assert.equal(named['Review Requests query']!.status, 'fail')
  assert.match(named['Review Requests query']!.detail, /Needs GitLab 17\.4\+/)
})

test('an orca row without a field the plugin reads fails, naming the field', async () => {
  const [row] = worktreePsEnvelope.result.worktrees
  const { worktreeId: _dropped, ...withoutId } = row!
  const { deps } = arrange({ orca: { ps: { ok: true, result: { worktrees: [withoutId] } } } })
  const named = byName(await runReadOnlyChecks(deps, { host: null }))
  assert.equal(named['orca worktree ps --json']!.status, 'fail')
  assert.match(named['orca worktree ps --json']!.detail, /worktrees\[0\]\.worktreeId/)
})

test('an orca error envelope fails the check with its message', async () => {
  const { deps } = arrange({
    orca: { list: { ok: false, error: { code: 'runtime_unavailable', message: 'Orca is not running' } } }
  })
  const named = byName(await runReadOnlyChecks(deps, { host: null }))
  assert.equal(named['orca worktree list --json']!.status, 'fail')
  assert.match(named['orca worktree list --json']!.detail, /Orca is not running/)
})
