// A Git that only records: which MR heads were fetched where, and answers `git status` from
// setStatus(). failNext() makes the next call fail.
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

  failNext(...errors: Error[]): void {
    this.#failures.push(...errors)
  }

  async fetchMergeRequestHead(repoPath: string, iid: number): Promise<string> {
    this.fetches.push({ repoPath, iid })
    const failure = this.#failures.shift()
    if (failure) throw failure
    return `origin/merge-requests/${iid}`
  }
}
