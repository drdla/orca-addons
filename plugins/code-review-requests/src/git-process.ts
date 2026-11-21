// The real Git seam: `git` from the worker's PATH (Orca passes PATH through its env allowlist).
// Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile } from 'node:child_process'
import { gitEnv } from './git-env'
import { mergeRequestHeadRef, targetBranchFullRef, targetBranchRef, type FileChange, type Git } from './seams/git'

const TIMEOUT_MS = 120_000
/** A diff of large files (generated, vendored) can outgrow execFile's 1 MB default. */
const DIFF_MAX_BUFFER = 64 * 1024 * 1024

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
 * The arguments that diff commit `from` with `to` for `paths` only (#58): as a NUL-separated
 * `--name-status` list (`files`; paths unquoted) or as zero-context hunks (`hunks`). The paths are
 * literal (no pathspec magic), and the `a/`/`b/` prefixes are fixed whatever the user's config.
 */
export function diffArgs(path: string, from: string, to: string, as: 'files' | 'hunks', paths: string[]): string[] {
  const format = as === 'files' ? ['--name-status', '-z'] : ['-U0']
  return [
    '--literal-pathspecs', '-C', path, 'diff', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', '-M', ...format, from, to, '--', ...paths
  ]
}

/**
 * Pairs the `--name-status -z` list with the `-U0` patch by path (not by position: a type change,
 * file to symlink, is one entry but two patch sections): paths from the list, touched lines from
 * the patch's `@@ -start,count` headers. A type change, a binary file, or a file the patch doesn't
 * show counts as wholly changed.
 */
export function parseFileChanges(nameStatusZ: string, patch: string): FileChange[] {
  const fields = nameStatusZ.split('\0')
  const sections = new Map<string, string[]>()
  for (const section of patch.split(/^diff --git /m).slice(1)) {
    const key = sectionKey(section)
    if (key !== null) sections.set(key, [...(sections.get(key) ?? []), section])
  }
  const changes: FileChange[] = []
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i]!
    if (status === '') continue
    const twoPaths = status[0] === 'R' || status[0] === 'C'
    const first = fields[++i] ?? ''
    const second = twoPaths ? (fields[++i] ?? '') : first
    const found = sections.get(`${first}\0${second}`)
    changes.push({
      oldPath: status[0] === 'A' ? null : first,
      newPath: status[0] === 'D' ? null : second,
      hunks: status[0] === 'T' || found?.length !== 1 ? 'all' : hunksOf(found[0]!)
    })
  }
  return changes
}

/** `<old path>\0<new path>` of one patch section (its header after `diff --git `, then its lines). */
function sectionKey(section: string): string | null {
  const lines = section.split('\n')
  const from = lines.find((l) => l.startsWith('rename from ') || l.startsWith('copy from '))
  const to = lines.find((l) => l.startsWith('rename to ') || l.startsWith('copy to '))
  if (from !== undefined && to !== undefined) {
    return `${unquote(from.slice(from.indexOf(' from ') + 6))}\0${unquote(to.slice(to.indexOf(' to ') + 4))}`
  }
  // Same path on both sides: `a/<p> b/<p>`, each quoted when the path has odd characters.
  const header = lines[0]!
  if (header.startsWith('"')) {
    const path = readQuoted(header)
    return path.startsWith('a/') ? `${path.slice(2)}\0${path.slice(2)}` : null
  }
  const length = (header.length - 5) / 2
  const path = header.slice(2, 2 + length)
  return header === `a/${path} b/${path}` ? `${path}\0${path}` : null
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

/** A path as git prints it in a patch: as is, or C-quoted (`"na\303\257ve \"q\".ts"`). */
function unquote(text: string): string {
  return text.startsWith('"') ? readQuoted(text) : text
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

/** Reads the C-quoted string `text` starts with; octal escapes are UTF-8 bytes. */
function readQuoted(text: string): string {
  const bytes: number[] = []
  let i = 1
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\') {
      const octal = /^[0-7]{3}/.exec(text.slice(i + 1, i + 4))
      if (octal) {
        bytes.push(Number.parseInt(octal[0], 8))
        i += 4
      } else {
        bytes.push(ESCAPES[text[i + 1]!] ?? text.charCodeAt(i + 1))
        i += 2
      }
    } else {
      const char = String.fromCodePoint(text.codePointAt(i)!)
      bytes.push(...Buffer.from(char, 'utf8'))
      i += char.length
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Runs `git <args>` and answers its stdout; rejects with `<what> failed: <stderr>`. */
async function run(args: string[], what: string, maxBuffer?: number): Promise<string> {
  const gitEnvironment = await env()
  const options = { timeout: TIMEOUT_MS, env: gitEnvironment, encoding: 'utf8' as const, ...(maxBuffer ? { maxBuffer } : {}) }
  return new Promise((resolve, reject) =>
    execFile('git', args, options, (error, stdout, stderr) =>
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
  async fileChanges(path, from, to, paths) {
    const [files, patch] = await Promise.all([
      run(diffArgs(path, from, to, 'files', paths), 'git diff --name-status', DIFF_MAX_BUFFER),
      run(diffArgs(path, from, to, 'hunks', paths), 'git diff', DIFF_MAX_BUFFER)
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
