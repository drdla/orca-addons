// A Git that only records: which branches and MR heads were fetched where (in order) and which
// worktrees were reset to what; answers `git status` from setStatus(), `rev-parse HEAD` from
// setHead() and other refs from setRef(). failNext() makes the next call fail; failNextOf() the
// next call of one method only.
import type { Git } from '../seams/git'

type Method = 'fetchMergeRequestHead' | 'fetchBranch' | 'resetBranch' | 'statusPorcelain' | 'headSha'

export class FakeGit implements Git {
  readonly fetches: ({ repoPath: string; iid: number } | { repoPath: string; branch: string })[] = []
  readonly resets: { worktreePath: string; ref: string }[] = []
  /** Every worktree `headSha` was asked about, in order. */
  readonly headReads: string[] = []
  #failures: Error[] = []
  #failuresOf = new Map<Method, Error[]>()
  #status = new Map<string, string[]>()
  #heads = new Map<string, string>()
  #refs = new Map<string, string>()

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

  failNext(...errors: Error[]): void {
    this.#failures.push(...errors)
  }

  /** The next call of `method` (only) rejects with `error`. */
  failNextOf(method: Method, error: Error): void {
    this.#failuresOf.set(method, [...(this.#failuresOf.get(method) ?? []), error])
  }

  #fail(method: Method): void {
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
    return `refs/remotes/origin/merge-requests/${iid}`
  }

  async fetchBranch(repoPath: string, branch: string): Promise<string> {
    this.fetches.push({ repoPath, branch })
    this.#fail('fetchBranch')
    return `origin/${branch}`
  }

  async resetBranch(worktreePath: string, ref: string): Promise<void> {
    this.#fail('resetBranch')
    this.resets.push({ worktreePath, ref })
    // The worktree is now at what `ref` names there (setRef), or back at FAKE_HEAD_SHA.
    const sha = this.#refs.get(`${worktreePath}\n${ref}`)
    if (sha === undefined) this.#heads.delete(worktreePath)
    else this.#heads.set(worktreePath, sha)
  }

  async resolveRef(path: string, ref: string): Promise<string | null> {
    return this.#refs.get(`${path}\n${ref}`) ?? null
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
