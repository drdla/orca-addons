// The real Git seam: `git` from the worker's PATH (Orca passes PATH through its env allowlist).
// Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile } from 'node:child_process'
import type { Git } from './seams/git'

const TIMEOUT_MS = 120_000

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
  statusPorcelain(path) {
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        ['-C', path, 'status', '--porcelain'],
        { timeout: TIMEOUT_MS, env: process.env, encoding: 'utf8' },
        (error, stdout, stderr) =>
          error
            ? reject(new Error(`git status failed: ${(stderr || error.message).trim()}`))
            : resolve(stdout.split('\n').filter((line) => line.trim() !== ''))
      )
    )
  },
  fetchMergeRequestHead(repoPath, iid) {
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        fetchMergeRequestHeadArgs(repoPath, iid),
        { timeout: TIMEOUT_MS, env: process.env, encoding: 'utf8' },
        (error, _stdout, stderr) =>
          error
            ? reject(new Error(`git fetch of the MR failed: ${(stderr || error.message).trim()}`))
            : resolve(`origin/merge-requests/${iid}`)
      )
    )
  },
  headSha(worktreePath) {
    return new Promise((resolve, reject) =>
      execFile(
        'git',
        ['-C', worktreePath, 'rev-parse', 'HEAD'],
        { timeout: TIMEOUT_MS, env: process.env, encoding: 'utf8' },
        (error, stdout, stderr) =>
          error
            ? reject(new Error(`git rev-parse HEAD failed: ${(stderr || error.message).trim()}`))
            : resolve(stdout.trim())
      )
    )
  }
}
