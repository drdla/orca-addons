// Contract tests for the real OrcaCli adapter: argv out, real envelopes (fixtures) in.
import { assert, test } from 'orca/testing'
import { worktreeListEnvelope, worktreeShowEnvelope, worktreeShowErrorEnvelope } from './fixtures/orca-cli-captures'
import { worktreePsEnvelope } from './fixtures/orca-cli-ps-capture'
import { createOrcaCli, type OrcaRun } from './orca-cli-process'
import { OrcaCliError } from './seams/orca-cli'

function runner(answer: OrcaRun | (() => Promise<OrcaRun>)) {
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)
    return typeof answer === 'function' ? answer() : answer
  }
  return { calls, cli: createOrcaCli(run) }
}

const ok = (envelope: unknown): OrcaRun => ({ exitCode: 0, stdout: JSON.stringify(envelope), stderr: '' })

test('lists worktrees with one `orca worktree list --json` and returns its rows', async () => {
  const { calls, cli } = runner(ok(worktreeListEnvelope))

  const rows = await cli.listWorktrees()

  assert.deepEqual(calls, [['worktree', 'list', '--limit', '10000', '--json']])
  assert.equal(rows.length, worktreeListEnvelope.result.worktrees.length)
  assert.equal(rows[0]!.projectId, worktreeListEnvelope.result.worktrees[0]!.projectId)
})

test("lists each worktree's agents with one `orca worktree ps --json`", async () => {
  const { calls, cli } = runner(ok(worktreePsEnvelope))

  const rows = await cli.listAgents()

  assert.deepEqual(calls, [['worktree', 'ps', '--limit', '10000', '--json']])
  assert.deepEqual(
    rows,
    worktreePsEnvelope.result.worktrees.map((row) => ({ worktreeId: row.worktreeId, agents: row.agents }))
  )
  assert.equal(rows[0]!.agents[0]!.state, 'working')
})

test('shows a worktree by selector', async () => {
  const { calls, cli } = runner(ok(worktreeShowEnvelope))
  const detail = await cli.showWorktree('id:x::/p')
  assert.deepEqual(calls, [['worktree', 'show', '--worktree', 'id:x::/p', '--json']])
  assert.equal(detail.id, worktreeShowEnvelope.result.worktree.id)
})

test('an error envelope on stdout with exit 1 becomes an OrcaCliError with its code', async () => {
  const { cli } = runner({ exitCode: 1, stdout: JSON.stringify(worktreeShowErrorEnvelope), stderr: '' })
  await assert.rejects(cli.showWorktree('id:nope'), (error) => {
    return error instanceof OrcaCliError && error.code === 'selector_not_found'
  })
})

test('output that is not an envelope, or a CLI that cannot start, is `unavailable`', async () => {
  const garbled = runner({ exitCode: 1, stdout: 'Orca is not running', stderr: 'boom' })
  await assert.rejects(garbled.cli.listWorktrees(), (error) => {
    return error instanceof OrcaCliError && error.code === 'unavailable' && /boom|not running/.test(error.message)
  })
  const missing = runner(() => Promise.reject(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })))
  await assert.rejects(missing.cli.listWorktrees(), (error) => {
    return error instanceof OrcaCliError && error.code === 'unavailable'
  })
})

test('creates a Review Workspace with the repo, base, MR link, no parent and no setup', async () => {
  const created = { ...worktreeShowEnvelope, result: { worktree: worktreeListEnvelope.result.worktrees[1] } }
  const { calls, cli } = runner(ok(created))

  const row = await cli.createWorktree({
    name: 'review-api-7',
    repo: 'id:r1',
    baseBranch: 'origin/merge-requests/7',
    gitlabMr: 'https://gitlab.example.com/acme/api/-/merge_requests/7',
    noParent: true,
    setup: 'skip'
  })

  assert.deepEqual(calls, [
    [
      'worktree', 'create', '--name', 'review-api-7', '--repo', 'id:r1',
      '--base-branch', 'origin/merge-requests/7',
      '--gitlab-mr', 'https://gitlab.example.com/acme/api/-/merge_requests/7',
      '--no-parent', '--setup', 'skip', '--json'
    ]
  ])
  assert.equal(row.id, worktreeListEnvelope.result.worktrees[1]!.id)
})

test('removes a worktree with the flags asked for', async () => {
  const { calls, cli } = runner(ok({ id: '1', ok: true, result: {} }))
  await cli.removeWorktree('id:r::/p', { force: true, deleteBranch: true })
  assert.deepEqual(calls, [['worktree', 'rm', '--worktree', 'id:r::/p', '--force', '--delete-branch', '--json']])
})

test("sets a worktree's display name only", async () => {
  const { calls, cli } = runner(ok({ id: '1', ok: true, result: {} }))
  await cli.setDisplayName('id:r::/p', 'REVIEW Add login')
  assert.deepEqual(calls, [['worktree', 'set', '--worktree', 'id:r::/p', '--display-name', 'REVIEW Add login', '--json']])
})

test('launches an agent with its prompt in a terminal of the worktree: `orca agent launch`', async () => {
  const { calls, cli } = runner(ok({ ok: true, result: { outcome: { kind: 'terminal', handle: 'term_1' } } }))

  await cli.launchAgent({ worktree: 'id:r::/wt', agent: 'claude', prompt: 'Review it', focus: true })
  await cli.launchAgent({ worktree: 'id:r::/wt', agent: 'codex', prompt: 'Review it' })

  assert.deepEqual(calls, [
    ['agent', 'launch', '--agent', 'claude', '--worktree', 'id:r::/wt', '--surface', 'terminal', '--prompt', 'Review it', '--focus', '--json'],
    ['agent', 'launch', '--agent', 'codex', '--worktree', 'id:r::/wt', '--surface', 'terminal', '--prompt', 'Review it', '--json']
  ])
})
