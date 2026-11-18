// Contract tests for the real OrcaCli adapter: argv out, real envelopes (fixtures) in.
import { assert, test } from 'orca/testing'
import { issueEnvelope, issueNotFoundEnvelope, teamListEnvelope, worktreeListEnvelope } from './fixtures/orca-cli-captures'
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

test('reads the board with one `orca worktree list` as cards with column, branch and Linear link', async () => {
  const { calls, cli } = runner(ok(worktreeListEnvelope))

  const board = await cli.board()

  assert.deepEqual(calls, [['worktree', 'list', '--limit', '10000', '--json']])
  assert.deepEqual(board, [
    {
      worktreeId: 'repo-1::/Users/me/GitLab/webapps',
      path: '/Users/me/GitLab/webapps',
      branch: 'dev',
      column: 'in-progress',
      linkedIssue: null,
      linkedWorkspaceId: null
    },
    {
      worktreeId: 'repo-1::/Users/me/orca/workspaces/webapps/oeo-1577-add-toggle',
      path: '/Users/me/orca/workspaces/webapps/oeo-1577-add-toggle',
      branch: 'oeo-1577-add-toggle',
      column: 'in-review',
      linkedIssue: 'OEO-1577',
      linkedWorkspaceId: 'ws-v'
    }
  ])
})

test('reads the Linear teams with their workspace URL key', async () => {
  const { calls, cli } = runner(ok(teamListEnvelope))

  const teams = await cli.linearTeams()

  assert.deepEqual(calls, [['linear', 'team', 'list', '--json']])
  assert.deepEqual(teams, [
    { key: 'COR', workspaceId: 'ws-v', workspace: 'vestigas' },
    { key: 'OEO', workspaceId: 'ws-v', workspace: 'vestigas' }
  ])
})

test('reads a ticket by identifier, in its Linear workspace when known', async () => {
  const { calls, cli } = runner(ok(issueEnvelope))

  const ticket = await cli.ticket({ identifier: 'OEO-1577', workspaceId: 'ws-v' })
  await cli.ticket({ identifier: 'OEO-1577', workspaceId: null })

  assert.deepEqual(calls, [
    ['linear', 'issue', 'OEO-1577', '--workspace', 'ws-v', '--json'],
    ['linear', 'issue', 'OEO-1577', '--json']
  ])
  assert.deepEqual(ticket, {
    identifier: 'OEO-1577',
    workspaceId: 'ws-v',
    workspace: 'vestigas',
    teamKey: 'OEO',
    stateName: 'Review',
    stateType: 'started'
  })
})

test('moves a card with `orca worktree set --workspace-status`', async () => {
  const { calls, cli } = runner(ok({ id: 'e5', ok: true, result: {} }))
  await cli.setColumn('repo-1::/w/a', 'in-review')
  assert.deepEqual(calls, [['worktree', 'set', '--worktree', 'id:repo-1::/w/a', '--workspace-status', 'in-review', '--json']])
})

test('an error envelope becomes an OrcaCliError with its code and message', async () => {
  const { cli } = runner({ exitCode: 1, stdout: JSON.stringify(issueNotFoundEnvelope), stderr: '' })
  await assert.rejects(cli.ticket({ identifier: 'OEO-0', workspaceId: null }), (error) => {
    return error instanceof OrcaCliError && error.code === 'linear_network_error' && /not found/.test(error.message)
  })
})

test('output that is not an envelope, or a CLI that cannot start, is `unavailable`', async () => {
  const garbled = runner({ exitCode: 1, stdout: 'Orca is not running', stderr: 'boom' })
  await assert.rejects(garbled.cli.board(), (error) => error instanceof OrcaCliError && error.code === 'unavailable')
  const missing = runner(() => Promise.reject(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })))
  await assert.rejects(missing.cli.board(), (error) => error instanceof OrcaCliError && error.code === 'unavailable')
})

test('a ticket answer without a state is `unexpected_output`', async () => {
  const broken = { ...issueEnvelope, result: { issue: { ...issueEnvelope.result.issue, state: null } } }
  const { cli } = runner(ok(broken))
  await assert.rejects(cli.ticket({ identifier: 'OEO-1577', workspaceId: null }), (error) => {
    return error instanceof OrcaCliError && error.code === 'unexpected_output'
  })
})
