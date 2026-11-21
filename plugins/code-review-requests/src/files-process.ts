// The real Files seam. Nothing here runs on load: `orca plugin check` imports the real worker.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Files } from './seams/files'

export const systemFiles: Files = {
  async readText(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
  async writeText(path, text) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, 'utf8')
  }
}
