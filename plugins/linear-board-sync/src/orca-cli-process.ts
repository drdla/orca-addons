// The real OrcaCli: the `orca` CLI by absolute path, always with `--json`, branching on the
// envelope `{ ok, result | error: { code, message, data } }`, which Orca prints on stdout even when
// it exits 1. Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile } from 'node:child_process'
import { messageOf } from './errors'
import { OrcaCliError, type OrcaCli } from './seams/orca-cli'
import type { BoardCard, LinearTeam, Ticket, TicketRef } from './sync/sync'

export const ORCA_BIN = '/Applications/Orca.app/Contents/Resources/bin/orca'
const TIMEOUT_MS = 60_000
/** High enough that the board is never cut short. */
const LIST_LIMIT = '10000'

export type OrcaRun = { exitCode: number; stdout: string; stderr: string }
/** Runs `orca <args>`; resolves with the output also on a non-zero exit, rejects if it can't start. */
export type RunOrca = (args: string[]) => Promise<OrcaRun>

/** The fields of an `orca worktree list` row the plugin reads. */
type WorktreeRow = {
  id: string
  path: string
  branch: string | null
  workspaceStatus?: string | null
  linkedLinearIssue?: string | null
  linkedLinearIssueWorkspaceId?: string | null
}

type TeamRow = { key: string; url: string; workspace: { id: string } }

type IssueRow = {
  identifier: string
  url: string
  state: { name: string; type: string } | null
  team: { key: string } | null
  assignee?: { id: string } | null
}

export function createOrcaCli(run: RunOrca): OrcaCli {
  /** The user's Linear id per Linear workspace id; it doesn't change while the worker runs. */
  const myIds = new Map<string, string>()
  async function call<T>(args: string[]): Promise<T> {
    let output: OrcaRun
    try {
      output = await run([...args, '--json'])
    } catch (error) {
      throw new OrcaCliError('unavailable', `Can't run the orca CLI: ${messageOf(error)}`)
    }
    let envelope: { ok?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } }
    try {
      envelope = JSON.parse(output.stdout)
    } catch {
      const said = (output.stderr || output.stdout).trim().slice(0, 300)
      throw new OrcaCliError('unavailable', `The orca CLI failed (exit ${output.exitCode}): ${said}`)
    }
    if (envelope.ok === true) return envelope.result as T
    const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'unavailable'
    const message = typeof envelope.error?.message === 'string' ? envelope.error.message : code
    throw new OrcaCliError(code, message, envelope.error?.data)
  }

  return {
    async board() {
      const result = await call<{ worktrees: WorktreeRow[] }>(['worktree', 'list', '--limit', LIST_LIMIT])
      return result.worktrees.map(cardOf)
    },
    async linearTeams() {
      const result = await call<{ teams: TeamRow[] }>(['linear', 'team', 'list'])
      return result.teams.map(
        (team): LinearTeam => ({ key: team.key.toUpperCase(), workspaceId: team.workspace.id, workspace: urlKeyOf(team.url) })
      )
    },
    async ticket(ref) {
      const { issue, meta } = await call<{ issue: IssueRow; meta?: { resolved?: { workspaceId?: string } } }>([
        'linear',
        'issue',
        ref.identifier,
        ...whereOf(ref)
      ])
      if (!issue?.state || !issue.team) {
        throw new OrcaCliError('unexpected_output', `orca linear issue ${ref.identifier} returned no state or team`)
      }
      const assigneeId = issue.assignee?.id ?? null
      const workspaceId = ref.workspaceId ?? meta?.resolved?.workspaceId ?? null
      const assignee =
        assigneeId === null ? null : workspaceId !== null && assigneeId === (await myId(workspaceId)) ? 'me' : 'colleague'
      return {
        identifier: issue.identifier.toUpperCase(),
        workspaceId: ref.workspaceId,
        workspace: urlKeyOf(issue.url),
        teamKey: issue.team.key.toUpperCase(),
        stateName: issue.state.name,
        stateType: issue.state.type,
        assignee
      } satisfies Ticket
    },
    async setColumn(worktreeId, column) {
      await call(['worktree', 'set', '--worktree', `id:${worktreeId}`, '--workspace-status', column])
    },
    async setState(ref, state) {
      await call(['linear', 'status', 'set', ref.identifier, '--to', state, ...whereOf(ref)])
    },
    async assignToMe(ref) {
      await call(['linear', 'assignee', 'set', ref.identifier, '--me', ...whereOf(ref)])
    }
  }

  /**
   * The user's Linear id in a Linear workspace, from any ticket assigned to them; the CLI has no
   * "who am I". Null when no ticket is: then no ticket is theirs. Not remembered until found.
   */
  async function myId(workspaceId: string): Promise<string | null> {
    const known = myIds.get(workspaceId)
    if (known !== undefined) return known
    const { issues } = await call<{ issues?: IssueRow[] }>([
      'linear',
      'list-issues',
      '--assignee',
      'me',
      '--limit',
      '1',
      '--workspace',
      workspaceId
    ])
    const id = issues?.[0]?.assignee?.id ?? null
    if (id !== null) myIds.set(workspaceId, id)
    return id
  }
}

function whereOf(ref: TicketRef): string[] {
  return ref.workspaceId === null ? [] : ['--workspace', ref.workspaceId]
}

function cardOf(row: WorktreeRow): BoardCard {
  return {
    worktreeId: row.id,
    path: row.path,
    branch: row.branch === null ? null : row.branch.replace(/^refs\/heads\//, ''),
    column: row.workspaceStatus ?? null,
    linkedIssue: row.linkedLinearIssue ?? null,
    linkedWorkspaceId: row.linkedLinearIssueWorkspaceId ?? null
  }
}

/** `https://linear.app/<key>/…` → `<key>`, lower case; empty if the URL has another shape. */
function urlKeyOf(url: string): string {
  return /^https:\/\/linear\.app\/([^/]+)\//.exec(url)?.[1]?.toLowerCase() ?? ''
}

/** Spawns the real CLI. */
export const spawnOrca: RunOrca = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      ORCA_BIN,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: process.env, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error && typeof error.code === 'string') return reject(error)
        const exitCode = error ? (typeof error.code === 'number' ? error.code : -1) : 0
        resolve({ exitCode, stdout, stderr: error?.killed ? `orca timed out. ${stderr}` : stderr })
      }
    )
  })
