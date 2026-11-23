// A Git that only records: which branches and MR heads were fetched where (in order) and which
// worktrees were reset to what; answers `git status` from setStatus(), `rev-parse HEAD` from
// setHead() and other refs from setRef(), ancestry from addAncestor(), diffs between two commits
// from setFileChanges() (recorded in `diffs`). failNext() makes the next
// call fail; failNextOf() the next call of one method only; onNextOf() runs something as it starts.
import { mergeRequestHeadRef, targetBranchRef, type FileChange, type Git } from '../seams/git'

type Method = 'fetchMergeRequestHead' | 'fetchBranch' | 'resetBranch' | 'deleteBranch' | 'statusPorcelain' | 'headSha' | 'fileChanges'

export class FakeGit implements Git {
  readonly fetches: ({ repoPath: string; iid: number } | { repoPath: string; branch: string })[] = []
  readonly resets: { worktreePath: string; ref: string }[] = []
  /** Every branch deleteBranch deleted, in order. */
  readonly deletedBranches: { repoPath: string; branch: string }[] = []
  /** Every worktree `headSha` was asked about, in order. */
  readonly headReads: string[] = []
  #failures: Error[] = []
  #failuresOf = new Map<Method, Error[]>()
  #status = new Map<string, string[]>()
  #heads = new Map<string, string>()
  #refs = new Map<string, string>()
  #remoteHeads = new Map<number, string>()
  #ancestors = new Set<string>()
  #hooks = new Map<Method, (() => void)[]>()
  #failAfterReset: Error[] = []
  #fileChanges = new Map<string, FileChange[]>()
  /** Every pair of commits fileChanges was asked about, in order. */
  readonly diffs: { from: string; to: string; paths: string[] }[] = []

  /** The uncommitted changes `git status --porcelain` reports at `path` (default: none). */
  setStatus(path: string, lines: string[]): void {
    this.#status.set(path, lines)
  }

  /** What headSha answers for a worktree; unset ones answer FAKE_HEAD_SHA. */
  setHead(worktreePath: string, sha: string): void {
    this.#heads.set(worktreePath, sha)
  }

  /** What resolveRef answers for `ref` at `path`; unset ones don't resolve. */
  setRef(path: string, ref: string, sha: string): void {
    this.#refs.set(`${path}\n${ref}`, sha)
  }

  /** What fetching MR `iid`'s head brings: its remote-tracking ref then names `sha` there. */
  setRemoteMergeRequestHead(iid: number, sha: string): void {
    this.#remoteHeads.set(iid, sha)
  }

  /** `ancestor` is an ancestor of `descendant` (every commit is its own ancestor anyway). */
  addAncestor(ancestor: string, descendant: string): void {
    this.#ancestors.add(`${ancestor}>${descendant}`)
  }

  /** Runs `hook` when `method` is next called, before it does anything. */
  onNextOf(method: Method, hook: () => void): void {
    this.#hooks.set(method, [...(this.#hooks.get(method) ?? []), hook])
  }

  /** The next reset moves the branch, then rejects (like a failing `--unset-upstream`). */
  failAfterNextReset(error: Error): void {
    this.#failAfterReset.push(error)
  }

  failNext(...errors: Error[]): void {
    this.#failures.push(...errors)
  }

  /** The next call of `method` (only) rejects with `error`. */
  failNextOf(method: Method, error: Error): void {
    this.#failuresOf.set(method, [...(this.#failuresOf.get(method) ?? []), error])
  }

  #fail(method: Method): void {
    this.#hooks.get(method)?.shift()?.()
    const failure = this.#failuresOf.get(method)?.shift() ?? this.#failures.shift()
    if (failure) throw failure
  }

  async statusPorcelain(path: string): Promise<string[]> {
    this.#fail('statusPorcelain')
    return [...(this.#status.get(path) ?? [])]
  }

  async fetchMergeRequestHead(repoPath: string, iid: number): Promise<string> {
    this.fetches.push({ repoPath, iid })
    this.#fail('fetchMergeRequestHead')
    const remote = this.#remoteHeads.get(iid)
    if (remote !== undefined) this.setRef(repoPath, mergeRequestHeadRef(iid), remote)
    return mergeRequestHeadRef(iid)
  }

  async fetchBranch(repoPath: string, branch: string): Promise<string> {
    this.fetches.push({ repoPath, branch })
    this.#fail('fetchBranch')
    return targetBranchRef(branch)
  }

  async resetBranch(worktreePath: string, ref: string): Promise<void> {
    this.#fail('resetBranch')
    this.resets.push({ worktreePath, ref })
    // The worktree is now at what `ref` names there (setRef), or back at FAKE_HEAD_SHA.
    const sha = this.#refs.get(`${worktreePath}\n${ref}`)
    if (sha === undefined) this.#heads.delete(worktreePath)
    else this.#heads.set(worktreePath, sha)
    const after = this.#failAfterReset.shift()
    if (after) throw after
  }

  async deleteBranch(repoPath: string, branch: string): Promise<void> {
    this.#fail('deleteBranch')
    this.deletedBranches.push({ repoPath, branch })
  }

  async isAncestor(_path: string, ancestor: string, descendant: string): Promise<boolean> {
    return ancestor === descendant || this.#ancestors.has(`${ancestor}>${descendant}`)
  }

  async resolveRef(path: string, ref: string): Promise<string | null> {
    return this.#refs.get(`${path}\n${ref}`) ?? null
  }

  /**
   * What fileChanges answers between `from` and `to` (anywhere), of the files it is asked about;
   * unset pairs changed nothing.
   */
  setFileChanges(from: string, to: string, changes: FileChange[]): void {
    this.#fileChanges.set(`${from}..${to}`, changes)
  }

  async fileChanges(_path: string, from: string, to: string, paths: string[]): Promise<FileChange[]> {
    this.diffs.push({ from, to, paths: [...paths] })
    this.#fail('fileChanges')
    const changes = this.#fileChanges.get(`${from}..${to}`) ?? []
    // Like git: a rename is found only when both paths are asked about; else it is a delete (or an add).
    return changes.flatMap((c): FileChange[] => {
      const old = c.oldPath !== null && paths.includes(c.oldPath)
      const now = c.newPath !== null && paths.includes(c.newPath)
      if (old && (now || c.newPath === null)) return [structuredClone(c)]
      if (old) return [{ oldPath: c.oldPath, newPath: null, hunks: 'all' }]
      if (now) return [{ oldPath: c.oldPath === c.newPath ? c.oldPath : null, newPath: c.newPath, hunks: 'all' }]
      return []
    })
  }

  async headSha(worktreePath: string): Promise<string> {
    this.headReads.push(worktreePath)
    this.#fail('headSha')
    return this.#heads.get(worktreePath) ?? FAKE_HEAD_SHA
  }

  /** Answers `<worktree>/.git/<name>`, as for a main worktree. */
  async gitPath(worktreePath: string, name: string): Promise<string> {
    const failure = this.#failures.shift()
    if (failure) throw failure
    return `${worktreePath}/.git/${name}`
  }
}

export const FAKE_HEAD_SHA = '0000000000000000000000000000000000000000'
