// The memory per Linked Workspace (src/sync/sync.ts → Memory), kept in plugin storage so it
// survives worker restarts. Keyed by worktree path, which Orca's workspace events carry too.
import type { OrcaWorkerApi } from 'orca/worker'
import type { Memory } from './sync/sync'

const KEY = 'memory'

export function createMemoryStore(storage: OrcaWorkerApi['storage']) {
  return {
    async load(): Promise<Memory> {
      const stored = await storage.get(KEY)
      return stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Memory) : {}
    },
    async save(memory: Memory): Promise<void> {
      await storage.set(KEY, memory as never)
    },
    async forget(path: string): Promise<void> {
      const memory = await this.load()
      if (!(path in memory)) return
      delete memory[path]
      await this.save(memory)
    }
  }
}
