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

export const systemGit: Git = {
  async statusPorcelain(path) {
    const gitEnvironment = await env()
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        ['-C', path, 'status', '--porcelain'],
        { timeout: TIMEOUT_MS, env: gitEnvironment, encoding: 'utf8' },
        (error, stdout, stderr) =>
          error
            ? reject(new Error(`git status failed: ${(stderr || error.message).trim()}`))
            : resolve(stdout.split('\n').filter((line) => line.trim() !== ''))
      )
    )
  },
  async fetchMergeRequestHead(repoPath, iid) {
    const gitEnvironment = await env()
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        fetchMergeRequestHeadArgs(repoPath, iid),
        { timeout: TIMEOUT_MS, env: gitEnvironment, encoding: 'utf8' },
        (error, _stdout, stderr) =>
          error
            ? reject(new Error(`git fetch of the MR failed: ${(stderr || error.message).trim()}`))
            : resolve(`origin/merge-requests/${iid}`)
      )
    )
  },
  async headSha(worktreePath) {
    const gitEnvironment = await env()
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        ['-C', worktreePath, 'rev-parse', 'HEAD'],
        { timeout: TIMEOUT_MS, env: gitEnvironment, encoding: 'utf8' },
        (error, stdout, stderr) =>
          error
            ? reject(new Error(`git rev-parse HEAD failed: ${(stderr || error.message).trim()}`))
            : resolve(stdout.trim())
      )
    )
  },
  async gitPath(worktreePath, name) {
    const gitEnvironment = await env()
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-path', name],
        { timeout: TIMEOUT_MS, env: gitEnvironment, encoding: 'utf8' },
        (error, stdout, stderr) =>
          error
            ? reject(new Error(`git rev-parse --git-path failed: ${(stderr || error.message).trim()}`))
            : resolve(stdout.trim())
      )
    )
  }
}
