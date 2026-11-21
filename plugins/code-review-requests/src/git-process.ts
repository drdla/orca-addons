// The real Git seam: `git` from the worker's PATH (Orca passes PATH through its env allowlist).
// Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile } from 'node:child_process'
import { gitEnv } from './git-env'
import { mergeRequestHeadRef, targetBranchFullRef, targetBranchRef, type Git } from './seams/git'

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
  return ['-C', repoPath, 'fetch', '--no-tags', 'origin', `+refs/heads/${branch}:${targetBranchFullRef(branch)}`]
}

/** The arguments that move a worktree's branch to `ref` (a full ref, so no branch shadows it). */
export function resetBranchArgs(worktreePath: string, ref: string): string[] {
  return ['-C', worktreePath, 'reset', '--hard', ref, '--']
}

/** The arguments that drop the upstream of a worktree's branch. */
export function unsetUpstreamArgs(worktreePath: string): string[] {
  return ['-C', worktreePath, 'branch', '--unset-upstream']
}

/** The arguments that ask whether `ancestor` is an ancestor of `descendant` (exit 0 yes, 1 no). */
export function isAncestorArgs(path: string, ancestor: string, descendant: string): string[] {
  return ['-C', path, 'merge-base', '--is-ancestor', ancestor, descendant]
}

/**
 * `git status --porcelain -z` as one `XY path` entry per change. Paths come unquoted; a rename or
 * copy is followed by its original path, which belongs to the same entry and is dropped here.
 */
export function parsePorcelainZ(stdout: string): string[] {
  const fields = stdout.split('\0')
  const entries: string[] = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field === '') continue
    entries.push(field)
    if (field[0] === 'R' || field[0] === 'C') i++
  }
  return entries
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
    return parsePorcelainZ(await run(['-C', path, 'status', '--porcelain', '-z'], 'git status'))
  },
  async fetchMergeRequestHead(repoPath, iid) {
    await run(fetchMergeRequestHeadArgs(repoPath, iid), 'git fetch of the MR')
    return mergeRequestHeadRef(iid)
  },
  async isAncestor(path, ancestor, descendant) {
    // Exit 1 means "no", so this can't go through run(), which rejects on any non-zero exit.
    const options = { timeout: TIMEOUT_MS, env: await env(), encoding: 'utf8' as const }
    return new Promise((resolve, reject) =>
      execFile('git', isAncestorArgs(path, ancestor, descendant), options, (error, _stdout, stderr) => {
        if (!error) resolve(true)
        else if (error.code === 1) resolve(false)
        else reject(new Error(`git merge-base --is-ancestor failed: ${(stderr || error.message).trim()}`))
      })
    )
  },
  async fetchBranch(repoPath, branch) {
    await run(fetchBranchArgs(repoPath, branch), `git fetch of the target branch ${branch}`)
    return targetBranchRef(branch)
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
