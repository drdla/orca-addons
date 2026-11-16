// Shared test helpers for driving the real worker over the fakes (src/fakes). Not a test file
// itself (no `.test.`), so the runner doesn't execute it; import it from tests.
import { mockHost, mountWorker } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Fakes } from '../fakes'
import { createWorker } from '../worker'

export const MINUTE = 60_000

/** Settings as real Orca hands them over: with the declared defaults filled in. */
export const CONFIGURED = { instanceUrl: 'https://gitlab.example.com', pollMinutes: 5 }

export type StatusBarUpdate = {
  id: string
  text?: string
  visible?: boolean
  icon?: string
  tone?: string
  tooltip?: string
}

export function lastStatusBar(host: ReturnType<typeof mockHost>): StatusBarUpdate | undefined {
  return host.callsOf('statusBar.update').at(-1) as StatusBarUpdate | undefined
}

export function reviewRequestPolls(fakes: Fakes): number {
  return fakes.gitlab.requests.filter((r) => r.operation === 'graphql ReviewRequests').length
}

/**
 * Mounts a configured worker and lets its first poll run. `changeSetting` stands in for Orca's
 * settings.onDidChange, which the test kit never fires (see src/poll.test.ts). Pass `host` to
 * share storage with an earlier run (a worker restart).
 */
export async function startWorker(
  fakes: Fakes,
  settings: Record<string, string | number> = CONFIGURED,
  host = mockHost({ settings })
) {
  const module = createWorker(fakes.deps)
  const listeners: ((change: { key: string }) => unknown)[] = []
  let orca: OrcaWorkerApi | undefined
  const worker = await mountWorker(
    {
      default: (api: OrcaWorkerApi) => {
        orca = api
        // The kit's api objects are frozen, so wrap with copies rather than patching them.
        const settingsApi = {
          ...api.settings,
          onDidChange(listener: (change: { key: string }) => void) {
            listeners.push(listener)
            return { dispose: () => void listeners.splice(listeners.indexOf(listener), 1) }
          }
        } as OrcaWorkerApi['settings']
        return module.default({ ...api, settings: settingsApi })
      },
      deactivate: module.deactivate
    },
    { host }
  )
  await fakes.clock.advance(0)
  const changeSetting = async (key: string, value: string | number) => {
    await orca!.settings.set(key, value)
    for (const listener of [...listeners]) await listener({ key })
    await fakes.clock.advance(0)
  }
  return { host, worker, changeSetting }
}
