// The real Git seam: `git` from the worker's PATH (Orca passes PATH through its env allowlist).
// Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile } from 'node:child_process'
import { gitEnv } from './git-env'
import type { Git } from './seams/git'

const TIMEOUT_MS = 120_000

function readLaunchdSshAuthSock(): Promise<string> {
  return new Promise((resolve) =>
    execFile('/bin/launchctl', ['getenv', 'SSH_AUTH_SOCK'], { timeout: 5_000, encoding: 'utf8' }, (error, stdout) =>
      resolve(error ? '' : stdout.trim())
    )
  )
}

/** Built once per worker: the launchd socket doesn't change while the user stays logged in. */
let envPromise: Promise<NodeJS.ProcessEnv> | undefined
function env(): Promise<NodeJS.ProcessEnv> {
  envPromise ??= gitEnv(process.env, process.platform, readLaunchdSshAuthSock)
  return envPromise
}

/** The arguments that fetch MR `iid`'s head into `refs/remotes/origin/merge-requests/<iid>`. */
export function fetchMergeRequestHeadArgs(repoPath: string, iid: number): string[] {
  return [
    '-C',
    repoPath,
    'fetch',
    '--no-tags',
    'origin',
    `+refs/merge-requests/${iid}/head:refs/remotes/origin/merge-requests/${iid}`
  ]
}

/** The arguments that fetch `branch` fresh into `refs/remotes/origin/<branch>` (#54). */
export function fetchBranchArgs(repoPath: string, branch: string): string[] {
  return ['-C', repoPath, 'fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]
}

/** The arguments that move a worktree's branch to `ref` (a full ref, so no branch shadows it). */
export function resetBranchArgs(worktreePath: string, ref: string): string[] {
  return ['-C', worktreePath, 'reset', '--hard', ref, '--']
}

/** The arguments that drop the upstream of a worktree's branch. */
export function unsetUpstreamArgs(worktreePath: string): string[] {
  return ['-C', worktreePath, 'branch', '--unset-upstream']
}

/** Runs `git <args>` and answers its stdout; rejects with `<what> failed: <stderr>`. */
async function run(args: string[], what: string): Promise<string> {
  const gitEnvironment = await env()
  return new Promise((resolve, reject) =>
    execFile('git', args, { timeout: TIMEOUT_MS, env: gitEnvironment, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(new Error(`${what} failed: ${(stderr || error.message).trim()}`)) : resolve(stdout)
    )
  )
}

export const systemGit: Git = {
  async statusPorcelain(path) {
    const stdout = await run(['-C', path, 'status', '--porcelain'], 'git status')
    return stdout.split('\n').filter((line) => line.trim() !== '')
  },
  async fetchMergeRequestHead(repoPath, iid) {
    await run(fetchMergeRequestHeadArgs(repoPath, iid), 'git fetch of the MR')
    return `refs/remotes/origin/merge-requests/${iid}`
  },
  async fetchBranch(repoPath, branch) {
    await run(fetchBranchArgs(repoPath, branch), `git fetch of the target branch ${branch}`)
    return `origin/${branch}`
  },
  async resetBranch(worktreePath, ref) {
    await run(resetBranchArgs(worktreePath, ref), `git reset to ${ref}`)
    // Orca adds new branches with --no-track, so there is usually no upstream to drop.
    await run(unsetUpstreamArgs(worktreePath), 'git branch --unset-upstream').catch((error: unknown) => {
      if (!/no upstream/i.test(String(error))) throw error
    })
  },
  async resolveRef(path, ref) {
    try {
      const stdout = await run(['-C', path, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], 'git rev-parse')
      return stdout.trim() || null
    } catch {
      return null
    }
  },
  async headSha(worktreePath) {
    return (await run(['-C', worktreePath, 'rev-parse', 'HEAD'], 'git rev-parse HEAD')).trim()
  },
  async gitPath(worktreePath, name) {
    const stdout = await run(
      ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-path', name],
      'git rev-parse --git-path'
    )
    return stdout.trim()
  }
}
