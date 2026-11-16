// The real process side of the glab transport: spawning and finding the binary. Kept apart from
// glab-transport.ts so the contract tests never load child_process.
import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import type { GlabRun, RunGlab } from './glab-transport'

/** GitLab's own GraphQL timeout is 30 s; allow a little more for glab and the network. */
const TIMEOUT_MS = 45_000

/**
 * Runs glab and resolves with its exit code and output, also when it exits non-zero (an HTTP
 * error) or is killed by the timeout. Rejects only when it can't be started (ENOENT, EACCES).
 */
export const spawnGlab: RunGlab = (file, args, stdin) =>
  new Promise<GlabRun>((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: process.env, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error && typeof error.code === 'string') return reject(error)
        const exitCode = error ? (typeof error.code === 'number' ? error.code : -1) : 0
        const killed = error?.killed ? `glab timed out after ${TIMEOUT_MS / 1000} s. ` : ''
        resolve({ exitCode, stdout, stderr: killed + stderr })
      }
    )
    child.stdin?.on('error', () => {}) // glab may exit before reading stdin; execFile reports it
    child.stdin?.end(stdin ?? '')
  })

export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
