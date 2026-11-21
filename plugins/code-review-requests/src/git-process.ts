// The real Git seam: `git` from the worker's PATH (Orca passes PATH through its env allowlist).
// Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile } from 'node:child_process'
import { gitEnv } from './git-env'
import { mergeRequestHeadRef, targetBranchFullRef, targetBranchRef, type FileChange, type Git } from './seams/git'

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

/**
 * The arguments that diff commit `from` with `to` (#58): as a NUL-separated `--name-status` list
 * (`files`; paths unquoted) or as zero-context hunks (`hunks`). Both use the same options, so git
 * lists the files in the same order and parseFileChanges can pair them up.
 */
export function diffArgs(path: string, from: string, to: string, as: 'files' | 'hunks'): string[] {
  const format = as === 'files' ? ['--name-status', '-z'] : ['-U0']
  return ['-C', path, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', ...format, from, to, '--']
}

/**
 * Pairs the `--name-status -z` list with the `-U0` patch, file by file in order: paths from the
 * list (the patch quotes odd ones), touched lines from the patch's `@@ -start,count` headers.
 */
export function parseFileChanges(nameStatusZ: string, patch: string): FileChange[] {
  const fields = nameStatusZ.split('\0')
  const sections = patch.split(/^diff --git /m).slice(1)
  const changes: FileChange[] = []
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i]!
    if (status === '') continue
    const twoPaths = status[0] === 'R' || status[0] === 'C'
    const first = fields[++i] ?? ''
    const second = twoPaths ? (fields[++i] ?? '') : first
    changes.push({
      oldPath: status[0] === 'A' ? null : first,
      newPath: status[0] === 'D' ? null : second,
      hunks: hunksOf(sections[changes.length] ?? '')
    })
  }
  return changes
}

function hunksOf(section: string): FileChange['hunks'] {
  const hunks: { start: number; count: number }[] = []
  for (const line of section.split('\n')) {
    if (line.startsWith('Binary files ')) return 'all'
    const match = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line)
    if (match) hunks.push({ start: Number(match[1]), count: match[2] === undefined ? 1 : Number(match[2]) })
  }
  return hunks
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
  async fileChanges(path, from, to) {
    const [files, patch] = await Promise.all([
      run(diffArgs(path, from, to, 'files'), 'git diff --name-status'),
      run(diffArgs(path, from, to, 'hunks'), 'git diff')
    ])
    return parseFileChanges(files, patch)
  },
  async gitPath(worktreePath, name) {
    const stdout = await run(
      ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-path', name],
      'git rev-parse --git-path'
    )
    return stdout.trim()
  }
}
