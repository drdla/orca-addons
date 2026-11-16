// The Connection section's and the setup checklist's panel requests (#8, #25): the connection
// view, saving and removing a token, "Use <host>" and copying the glab login command.
// worker.ts calls registerConnectionRequests once in activate.
import type { OrcaWorkerApi } from 'orca/worker'
import type { Deps } from './deps'
import type { ReviewRequestsSnapshot } from './protocol'
import type { Settings } from './settings'
import { createTokenMode } from './token-mode'

export function registerConnectionRequests(
  orca: OrcaWorkerApi,
  options: {
    deps: Deps
    settings: () => Promise<Settings>
    isConfigured: () => Promise<boolean>
    /** Re-reads the settings and polls at once (the connection changed). */
    reconnect: () => Promise<void>
    /** The other hosts glab is logged in to, as the last poll found (#8). */
    glabHosts: () => string[]
    snapshot: () => Promise<ReviewRequestsSnapshot>
  }
): void {
  const tokenMode = createTokenMode({
    deps: options.deps,
    secrets: orca.secrets,
    protection: async () => {
      const answer = await orca.host.call('secrets.protection').catch(() => null)
      return answer?.status === 'unavailable' ? 'unavailable' : 'os-keyring'
    },
    settings: options.settings,
    isConfigured: options.isConfigured,
    onTokenChanged: options.reconnect
  })
  orca.panels.handle('rr.connection', async ({ test }) => tokenMode.view(test))
  orca.panels.handle('rr.saveToken', async ({ token }) => tokenMode.save(token))
  orca.panels.handle('rr.removeToken', async () => tokenMode.remove())

  // "Use <host>" (#8): the instance URL is the single source of truth, so this only sets it.
  orca.panels.handle('rr.useHost', async ({ host }) => {
    if (!options.glabHosts().includes(host)) throw new Error(`glab is not logged in to ${host}.`)
    await orca.settings.set('instanceUrl', `https://${host}`)
    await options.reconnect()
    return options.snapshot()
  })
  orca.panels.handle('rr.copyText', async ({ text }) => {
    await options.deps.desktop.copyText(text)
    return { copied: true as const }
  })
}
