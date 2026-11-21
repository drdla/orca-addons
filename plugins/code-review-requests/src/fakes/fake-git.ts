// A Git that only records: which branches and MR heads were fetched where (in order) and which
// worktrees were reset to what; answers `git status` from setStatus() and `rev-parse HEAD` from
// setHead(). failNext() makes the next call fail; failNextReset() only the next reset.
import type { Git } from '../seams/git'

export class FakeGit implements Git {
  readonly fetches: ({ repoPath: string; iid: number } | { repoPath: string; branch: string })[] = []
  readonly resets: { worktreePath: string; ref: string }[] = []
  #failures: Error[] = []
  #resetFailures: Error[] = []
  #status = new Map<string, string[]>()

  /** The uncommitted changes `git status --porcelain` reports at `path` (default: none). */
  setStatus(path: string, lines: string[]): void {
    this.#status.set(path, lines)
  }

  async statusPorcelain(path: string): Promise<string[]> {
    const failure = this.#failures.shift()
    if (failure) throw failure
    return [...(this.#status.get(path) ?? [])]
  }

  #heads = new Map<string, string>()

  /** What headSha answers for a worktree; unset ones answer FAKE_HEAD_SHA. */
  setHead(worktreePath: string, sha: string): void {
    this.#heads.set(worktreePath, sha)
  }

  failNext(...errors: Error[]): void {
    this.#failures.push(...errors)
  }

  async fetchMergeRequestHead(repoPath: string, iid: number): Promise<string> {
    this.fetches.push({ repoPath, iid })
    const failure = this.#failures.shift()
    if (failure) throw failure
    return `origin/merge-requests/${iid}`
  }

  failNextReset(error: Error): void {
    this.#resetFailures.push(error)
  }

  async fetchBranch(repoPath: string, branch: string): Promise<string> {
    this.fetches.push({ repoPath, branch })
    const failure = this.#failures.shift()
    if (failure) throw failure
    return `origin/${branch}`
  }

  async resetHard(worktreePath: string, ref: string): Promise<void> {
    const failure = this.#resetFailures.shift() ?? this.#failures.shift()
    if (failure) throw failure
    this.resets.push({ worktreePath, ref })
  }

  async headSha(worktreePath: string): Promise<string> {
    const failure = this.#failures.shift()
    if (failure) throw failure
    return this.#heads.get(worktreePath) ?? FAKE_HEAD_SHA
  }
}

export const FAKE_HEAD_SHA = '0000000000000000000000000000000000000000'
