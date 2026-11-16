// Files in memory, by absolute path. failNext() makes the next read fail.
import type { Files } from '../seams/files'

export class FakeFiles implements Files {
  /** Every path read, in order. */
  readonly reads: string[] = []
  #files = new Map<string, string>()
  #failures: Error[] = []

  write(path: string, text: string): void {
    this.#files.set(path, text)
  }

  delete(path: string): void {
    this.#files.delete(path)
  }

  failNext(...errors: Error[]): void {
    this.#failures.push(...errors)
  }

  async readText(path: string): Promise<string | null> {
    this.reads.push(path)
    const failure = this.#failures.shift()
    if (failure) throw failure
    return this.#files.get(path) ?? null
  }
}
