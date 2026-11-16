// A Git that only records: which MR heads were fetched where; answers `git status` from
// setStatus() and `rev-parse HEAD` from setHead(). failNext() makes the next call fail.
import type { Git } from '../seams/git'

export class FakeGit implements Git {
  readonly fetches: { repoPath: string; iid: number }[] = []
  #failures: Error[] = []
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

  async headSha(worktreePath: string): Promise<string> {
    const failure = this.#failures.shift()
    if (failure) throw failure
    return this.#heads.get(worktreePath) ?? FAKE_HEAD_SHA
  }
}

export const FAKE_HEAD_SHA = '0000000000000000000000000000000000000000'
