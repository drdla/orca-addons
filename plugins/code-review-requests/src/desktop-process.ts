// The real Desktop: `pbcopy` for the clipboard, and `orca plugin open` for the panel (gotcha 10:
// the worker can't learn its own plugin key, so it is looked up in `orca plugin list --json`).
// Nothing here runs on load: `orca plugin check` imports the real worker.
import { execFile, spawn } from 'node:child_process'
import type { Desktop } from './seams/desktop'

const ORCA_BIN = '/Applications/Orca.app/Contents/Resources/bin/orca'
const PLUGIN_ID = 'code-review-requests'

/** This plugin's key in `orca plugin list --json` output, preferring a loaded dev copy. */
export function pluginKeyFrom(stdout: string): string | null {
  let plugins: { pluginKey?: unknown; isDev?: unknown }[]
  try {
    plugins = JSON.parse(stdout)?.result?.plugins ?? []
  } catch {
    return null
  }
  const mine = plugins.filter(
    (p) => typeof p.pluginKey === 'string' && p.pluginKey.endsWith(`.${PLUGIN_ID}`)
  )
  const chosen = mine.find((p) => p.isDev === true) ?? mine[0]
  return chosen ? String(chosen.pluginKey) : null
}

export const systemDesktop: Desktop = {
  copyText(text) {
    return new Promise((resolve, reject) => {
      const child = execFile('/usr/bin/pbcopy', (error) => (error ? reject(error) : resolve()))
      child.stdin?.end(text)
    })
  },
  async openPanel(panelId) {
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(ORCA_BIN, ['plugin', 'list', '--json'], { timeout: 30_000 }, (error, out) =>
        error ? reject(error) : resolve(out)
      )
    )
    const key = pluginKeyFrom(stdout)
    if (key === null) throw new Error(`Orca does not list the ${PLUGIN_ID} plugin`)
    // Detached: the CLI may outlive the command that started it.
    spawn(ORCA_BIN, ['plugin', 'open', key, '--panel', panelId], {
      stdio: 'ignore',
      detached: true
    }).unref()
  }
}
