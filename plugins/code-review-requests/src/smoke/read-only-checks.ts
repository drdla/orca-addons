// The live smoke script's read-only checks (#31): what the plugin relies on but its tests can
// only fake. Each check goes through the plugin's own modules (the glab transport, the Review
// Requests and approvals queries, `glab auth status` parsing, the orca CLI adapter) and compares
// what comes back with the sanitized captures the fakes are pinned to. Nothing here writes: the
// GraphQL queries are POSTs, but read-only ones, and the orca commands are `list` and `ps`.
import { createApprovalsReader, REVIEW_REQUEST_APPROVALS_QUERY, type ApprovalsResponse } from '../gitlab/approvals'
import { fetchReviewRequests, fetchUsername } from '../gitlab/fetch-review-requests'
import { loggedInHosts } from '../gitlab/glab-auth-status'
import { REVIEW_REQUESTS_QUERY } from '../gitlab/review-requests-query'
import { MINIMUM_GITLAB } from '../gitlab/version-check'
import { messageOf } from '../errors'
import { mergeRequestReviewersBody } from '../fixtures/gitlab-reviewers-capture'
import { reviewRequestsBody } from '../fixtures/gitlab-captures'
import { worktreeListEnvelope } from '../fixtures/orca-cli-captures'
import { worktreePsEnvelope } from '../fixtures/orca-cli-ps-capture'
import { shapeMismatches } from '../fixtures/shape'
import { createOrcaCli, type RunOrca } from '../orca-cli-process'
import type { ReviewRequestView } from '../protocol'
import type { GitLabTransport } from '../seams/gitlab'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'
export type Check = { name: string; status: CheckStatus; detail: string }

/** The outside world, real in the script (main.ts) and faked in the tests. */
export type ReadOnlyDeps = {
  /** The absolute path of glab, or null when it isn't installed. */
  locateGlab(): string | null
  /** What `glab auth status` printed (stdout and stderr). */
  glabAuthStatus(glab: string): Promise<string>
  /** The glab transport for a host. */
  gitLab(host: string): GitLabTransport
  runOrca: RunOrca
}

export async function runReadOnlyChecks(deps: ReadOnlyDeps, options: { host: string | null }): Promise<Check[]> {
  const checks: Check[] = []
  const add = (name: string, status: CheckStatus, detail: string) => checks.push({ name, status, detail })
  await gitLabChecks(deps, options.host, add)
  await orcaChecks(deps.runOrca, add)
  return checks
}

type Add = (name: string, status: CheckStatus, detail: string) => void

const GITLAB_CHECKS_AFTER_LOGIN = [
  'GitLab version',
  'Current user',
  'Review Requests query',
  'Review Requests response shape',
  'Reviewers (requested at)',
  'Approvals query (optional)'
]

async function gitLabChecks(deps: ReadOnlyDeps, wanted: string | null, add: Add): Promise<void> {
  const skipRest = (why: string) => GITLAB_CHECKS_AFTER_LOGIN.forEach((name) => add(name, 'skip', why))

  const glab = deps.locateGlab()
  if (glab === null) {
    add('glab found', 'fail', 'not on PATH or in /opt/homebrew/bin, /usr/local/bin, ~/.local/bin (or pass --glab <path>)')
    add('glab auth status', 'skip', 'no glab')
    return skipRest('no glab')
  }
  add('glab found', 'pass', glab)

  let hosts: string[]
  try {
    hosts = loggedInHosts(await deps.glabAuthStatus(glab))
  } catch (error) {
    add('glab auth status', 'fail', messageOf(error))
    return skipRest('glab auth status failed')
  }
  const host = wanted ?? hosts[0] ?? null
  if (host === null) {
    add('glab auth status', 'fail', 'no "✓ Logged in to <host> as" line: run `glab auth login`')
    return skipRest('not logged in')
  }
  if (!hosts.includes(host)) {
    add('glab auth status', 'fail', `not logged in to ${host} (logged in to: ${hosts.join(', ') || 'none'})`)
    return skipRest(`not logged in to ${host}`)
  }
  add('glab auth status', 'pass', `logged in to ${hosts.join(', ')}; checking ${host}`)

  const transport = deps.gitLab(host)
  await check(add, 'GitLab version', async () => {
    const { version } = await transport.rest<{ version: string }>('GET', '/version')
    const [major = 0, minor = 0] = version.split('.').map((n) => Number.parseInt(n, 10))
    const atLeast = (a: number, b: number) => major > a || (major === a && minor >= b)
    const posting = atLeast(19, 2) ? 'bulk_publish takes the summary' : 'posts via a /submit_review note'
    if (!atLeast(MINIMUM_GITLAB.major, MINIMUM_GITLAB.minor)) return ['fail', `${version}: the plugin needs 17.4+`]
    return ['pass', `${version} (${posting})`]
  })

  let me: string
  try {
    me = await fetchUsername(transport)
    add('Current user', 'pass', `@${me}`)
  } catch (error) {
    add('Current user', 'fail', messageOf(error))
    return GITLAB_CHECKS_AFTER_LOGIN.slice(2).forEach((name) => add(name, 'skip', 'no current user'))
  }

  let views: ReviewRequestView[] = []
  await check(add, 'Review Requests query', async () => {
    views = await fetchReviewRequests(transport, me)
    return ['pass', `${views.length} Review Requests`]
  })

  await check(add, 'Review Requests response shape', async () => {
    const data = await transport.graphql<unknown>(REVIEW_REQUESTS_QUERY, { me })
    return differences(data, reviewRequestsBody.data, 'the first page has the fields and types the plugin reads')
  })

  await check(add, 'Reviewers (requested at)', async () => {
    const first = views[0]
    if (first === undefined) return ['skip', 'no Review Request to ask about']
    const path = `/projects/${encodeURIComponent(first.projectPath)}/merge_requests/${first.iid}/reviewers`
    const rows = await transport.rest<{ user?: { username?: string }; created_at?: string }[]>('GET', path)
    const mine = rows.find((row) => row.user?.username === me)
    if (mine === undefined) return ['fail', `!${first.iid}: you are not in its reviewers`]
    if (Number.isNaN(Date.parse(mine.created_at ?? ''))) return ['fail', `!${first.iid}: no created_at on your row`]
    return differences(rows, mergeRequestReviewersBody, `!${first.iid}: requested at ${mine.created_at}`)
  })

  await check(add, 'Approvals query (optional)', async () => {
    // Asked directly for GitLab's message; the plugin's reader only hides the badge on failure.
    try {
      await transport.graphql<ApprovalsResponse>(REVIEW_REQUEST_APPROVALS_QUERY, { me })
    } catch (error) {
      return ['warn', `unavailable, so no approvals badge (the list is unaffected): ${messageOf(error)}`]
    }
    const byUrl = await createApprovalsReader(transport).read(me)
    const withRules = [...(byUrl?.values() ?? [])].filter((a) => a !== null).length
    return ['pass', `${withRules} with required approvals`]
  })
}

async function orcaChecks(runOrca: RunOrca, add: Add): Promise<void> {
  // The plugin's adapter parses the envelope; the raw stdout is kept for the shape checks.
  const outputs: string[] = []
  const cli = createOrcaCli(async (args) => {
    const run = await runOrca(args)
    outputs.push(run.stdout)
    return run
  })
  const rowsOf = () => (JSON.parse(outputs.at(-1)!) as { result: { worktrees: unknown[] } }).result.worktrees

  await check(add, 'orca worktree list --json', async () => {
    await cli.listWorktrees()
    const rows = rowsOf()
    return rowCheck(rows, worktreeListEnvelope.result.worktrees, {
      id: ['string'],
      repoId: ['string'],
      projectId: ['string'],
      path: ['string'],
      isMainWorktree: ['boolean'],
      branch: ['string', 'null'],
      displayName: ['string'],
      linkedGitLabMR: ['number', 'null'],
      linkedItems: ['array']
    })
  })

  await check(add, 'orca worktree ps --json', async () => {
    await cli.listAgents()
    const rows = rowsOf()
    const problems = rows.flatMap((row, i) =>
      ((row as { agents?: unknown[] }).agents ?? []).flatMap((agent, j) =>
        typeof (agent as { state?: unknown }).state === 'string' ? [] : [`worktrees[${i}].agents[${j}].state`]
      )
    )
    const result = rowCheck(rows, worktreePsEnvelope.result.worktrees, {
      worktreeId: ['string'],
      agents: ['array', 'undefined']
    })
    return problems.length === 0 ? result : ['fail', `missing or not a string: ${problems.slice(0, 3).join(', ')}`]
  })
}

type Kind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'undefined'

/** Fails on a row lacking a field the plugin reads; reports other drift from the capture. */
function rowCheck(rows: unknown[], captured: unknown[], required: Record<string, Kind[]>): [CheckStatus, string] {
  const problems = rows.flatMap((row, i) =>
    Object.entries(required)
      .filter(([key, kinds]) => !kinds.includes(kindOf((row as Record<string, unknown>)[key])))
      .map(([key, kinds]) => `worktrees[${i}].${key} (want ${kinds.join(' or ')})`)
  )
  if (problems.length > 0) return ['fail', `fields the plugin reads: ${problems.slice(0, 3).join(', ')}`]
  return differences(rows, captured, `${rows.length} rows, every field the plugin reads is there`)
}

function kindOf(value: unknown): Kind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as Kind
}

/** Pass, noting where the live answer's shape differs from the capture (new or missing keys). */
function differences(live: unknown, captured: unknown, ok: string): [CheckStatus, string] {
  const found = shapeMismatches(live, captured, { exact: true })
  if (found.length === 0) return ['pass', ok]
  const typeChanges = found.filter((f) => !/: (missing|not in the capture)$/.test(f))
  const listed = [...new Set(found.map((f) => f.replace(/\[\d+\]/g, '[]')))].slice(0, 4).join('; ')
  return [typeChanges.length > 0 ? 'warn' : 'pass', `${ok}; keys added or missing vs. the capture: ${listed}`]
}

async function check(add: Add, name: string, run: () => Promise<[CheckStatus, string]>): Promise<void> {
  try {
    const [status, detail] = await run()
    add(name, status, detail)
  } catch (error) {
    add(name, 'fail', messageOf(error))
  }
}

const LABELS: Record<CheckStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' }

export function formatReport(checks: Check[]): string {
  const width = Math.max(...checks.map((c) => c.name.length))
  const lines = checks.map((c) => `${LABELS[c.status]}  ${c.name.padEnd(width)}  ${c.detail}`)
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length
  lines.push('', `${count('pass')} passed, ${count('fail')} failed, ${count('warn')} warnings, ${count('skip')} skipped`)
  return lines.join('\n')
}
