// The real Files seam. Nothing here runs on load: `orca plugin check` imports the real worker.
import { readFile } from 'node:fs/promises'
import type { Files } from './seams/files'

export const systemFiles: Files = {
  async readText(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}
