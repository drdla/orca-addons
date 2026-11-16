// The real OrcaCli: the `orca` CLI by absolute path (research #2), always with `--json`, branching
// on the envelope `{ ok, result | error: { code, message, data } }`, which Orca prints on stdout
// even when it exits 1. Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile } from 'node:child_process'
import {
  OrcaCliError,
  type CreateWorktreeInput,
  type OrcaCli,
  type Worktree,
  type WorktreeAgents,
  type WorktreeDetail
} from './seams/orca-cli'
import { messageOf } from './errors'

export const ORCA_BIN = '/Applications/Orca.app/Contents/Resources/bin/orca'
/** Creating a workspace runs Orca's setup; give it time. */
const TIMEOUT_MS = 180_000

export type OrcaRun = { exitCode: number; stdout: string; stderr: string }
/** Runs `orca <args>`; resolves with the output also on a non-zero exit, rejects if it can't start. */
export type RunOrca = (args: string[]) => Promise<OrcaRun>

/** High enough that the list is never cut short: Review Workspaces may be anywhere in it. */
const LIST_LIMIT = '10000'

export function createOrcaCli(run: RunOrca): OrcaCli {
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
    async listWorktrees() {
      const result = await call<{ worktrees: Worktree[] }>(['worktree', 'list', '--limit', LIST_LIMIT])
      return result.worktrees
    },
    async listAgents() {
      const result = await call<{ worktrees: WorktreeAgents[] }>(['worktree', 'ps', '--limit', LIST_LIMIT])
      return result.worktrees.map((row) => ({ worktreeId: row.worktreeId, agents: row.agents ?? [] }))
    },
    async showWorktree(selector) {
      return (await call<{ worktree: WorktreeDetail }>(['worktree', 'show', '--worktree', selector])).worktree
    },
    async createWorktree(input) {
      const result = await call<{ worktree?: Worktree }>(createArgs(input))
      // Unverified live: the create envelope is assumed to carry `result.worktree` like `show`.
      if (!result?.worktree) throw new OrcaCliError('unexpected_output', 'orca worktree create returned no worktree')
      return result.worktree
    },
    async removeWorktree(selector, options = {}) {
      await call(['worktree', 'rm', '--worktree', selector, ...(options.force ? ['--force'] : []),
        ...(options.deleteBranch ? ['--delete-branch'] : [])])
    }
  }
}

function createArgs(input: CreateWorktreeInput): string[] {
  const args = ['worktree', 'create', '--name', input.name]
  const flag = (name: string, value: string | undefined) => {
    if (value !== undefined) args.push(name, value)
  }
  flag('--repo', input.repo)
  flag('--project', input.project)
  flag('--base-branch', input.baseBranch)
  flag('--branch', input.branch)
  for (const reference of input.references ?? []) flag('--reference', reference)
  flag('--gitlab-mr', input.gitlabMr)
  flag('--agent', input.agent)
  flag('--prompt', input.prompt)
  flag('--comment', input.comment)
  if (input.noParent) args.push('--no-parent')
  if (input.activate) args.push('--activate')
  return args
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
