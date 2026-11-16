// A Git that only records: which MR heads were fetched where. failNext() makes the next call fail.
import type { Git } from '../seams/git'

export class FakeGit implements Git {
  readonly fetches: { repoPath: string; iid: number }[] = []
  #failures: Error[] = []

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
