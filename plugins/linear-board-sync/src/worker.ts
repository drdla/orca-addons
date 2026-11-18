// The plugin's worker: gathers the sync's inputs through the orca CLI, runs the pure sync
// (src/sync/sync.ts), applies the card moves and persists the memory. Orca transpiles this file
// on load; a save, update or crash restarts it, so the memory lives in orca.storage.
//
// activate() stays side-effect-free until the settings hold `pollMinutes`: real Orca fills in the
// manifest defaults, the test kit and `orca plugin check` do not. `check` runs the real worker, so
// starting the poll there would read and move real cards. A check scenario must never seed it.
import type { OrcaWorkerApi } from 'orca/worker'
import { realDeps, type Deps } from './deps'
import { messageOf } from './errors'
import { createMemoryStore } from './memory'
import { createPoller } from './poller'
import { parseSettings } from './settings'
import { createStatusBar, type SyncStatus } from './status-bar'
import { syncBoard, ticketsToFetch, type Ticket } from './sync/sync'

export const SYNC_NOW_COMMAND = 'linear-board-sync.syncNow'
export const PAUSE_COMMAND = 'linear-board-sync.pause'

const MINUTE = 60_000

type SyncOutcome = { moved: number; warnings: string[] }

function isConfigured(stored: Record<string, unknown>): boolean {
  return typeof stored.pollMinutes === 'number'
}

/** Builds the worker module over the given seams; tests pass fakes. */
export function createWorker(deps: Deps) {
  let stopWorker: (() => void) | null = null

  async function activate(orca: OrcaWorkerApi): Promise<void> {
    const { cli, clock } = deps
    const log = (message: string) => orca.log(message)
    const memoryStore = createMemoryStore(orca.storage)
    const statusBar = createStatusBar(orca)
    let paused = false

    /** Syncs run one at a time, so two never move the same card or race on the memory. */
    let queue: Promise<unknown> = Promise.resolve()
    function serially<T>(task: () => Promise<T>): Promise<T> {
      const next = queue.then(task)
      queue = next.catch(() => {})
      return next
    }

    /** One sync: every Linked Workspace, or (`onlyPath`) the one workspace just created. */
    async function sync(onlyPath?: string): Promise<SyncOutcome> {
      const parsed = parseSettings(await orca.settings.get())
      poller.setIntervalMs(Math.max(1, parsed.pollMinutes) * MINUTE)
      const warnings = [...parsed.problems]
      let moved = 0
      try {
        const board = await cli.board()
        const teams = await cli.linearTeams()
        const scope = onlyPath === undefined ? board : board.filter((card) => card.path === onlyPath)
        const tickets: Ticket[] = []
        for (const ref of ticketsToFetch({ teams, board: scope, settings: parsed.settings })) {
          try {
            tickets.push(await cli.ticket(ref))
          } catch (error) {
            warnings.push(`${ref.identifier}: couldn't read the ticket: ${messageOf(error)}`)
          }
        }
        const before = await memoryStore.load()
        // The whole board goes in: cards whose ticket wasn't read keep their memory.
        const result = syncBoard({ linear: { teams, tickets }, board, memory: before, settings: parsed.settings })
        warnings.push(...result.warnings)
        const memory = result.memory
        for (const move of result.moves) {
          try {
            await cli.setColumn(move.worktreeId, move.to)
            moved++
          } catch (error) {
            // Skipped, not retried: the next sync tries again, once.
            warnings.push(`${move.identifier}: couldn't move the card to "${move.to}": ${messageOf(error)}`)
            const known = before[move.path]
            if (known) memory[move.path] = known
            else delete memory[move.path]
          }
        }
        await memoryStore.save(memory)
      } catch (error) {
        warnings.push(`Couldn't sync: ${messageOf(error)}`)
      }
      for (const warning of warnings) log(`warning: ${warning}`)
      await statusBar.render(paused ? { kind: 'paused' } : { kind: 'synced', at: clock.now(), warnings })
      return { moved, warnings }
    }

    const poller = createPoller({
      clock,
      intervalMs: 2 * MINUTE,
      poll: async () => {
        await serially(() => sync())
      }
    })

    async function render(status: SyncStatus): Promise<void> {
      await statusBar.render(status).catch((error: unknown) => log(`status bar: ${messageOf(error)}`))
    }

    async function startIfConfigured(): Promise<void> {
      if (paused || poller.running || !isConfigured(await orca.settings.get())) return
      await render({ kind: 'starting' })
      poller.start()
    }

    orca.events.on('workspace.created', async ({ path }) => {
      if (paused || !poller.running) return
      await serially(() => sync(path))
    })
    orca.events.on('workspace.removed', async ({ path }) => {
      await serially(() => memoryStore.forget(path))
    })

    orca.commands.register(SYNC_NOW_COMMAND, async () => {
      if (paused) return 'Linear Board Sync is paused. Run "Linear Board Sync: Pause" again to resume.'
      if (!poller.running) return 'Linear Board Sync is not set up yet.'
      return summary(await serially(() => sync()))
    })
    orca.commands.register(PAUSE_COMMAND, async () => {
      if (!paused) {
        paused = true
        poller.stop()
        await render({ kind: 'paused' })
        return 'Linear Board Sync paused. Run "Linear Board Sync: Pause" again to resume.'
      }
      paused = false
      // Resuming forgets every card, so drags made while paused are discarded and Linear re-applied.
      await serially(() => memoryStore.save({}))
      await startIfConfigured()
      await poller.pollNow()
      return 'Linear Board Sync resumed.'
    })

    const settingsWatch = orca.settings.onDidChange(() =>
      startIfConfigured().catch((error: unknown) => log(`settings: ${messageOf(error)}`))
    )
    stopWorker = () => {
      settingsWatch.dispose()
      poller.stop()
    }
    await startIfConfigured()
  }

  return {
    default: activate,
    deactivate(): void {
      stopWorker?.()
      stopWorker = null
    }
  }
}

function summary(outcome: SyncOutcome): string {
  const moved = `${outcome.moved} ${outcome.moved === 1 ? 'card' : 'cards'} moved`
  if (outcome.warnings.length === 0) return `Synced with Linear: ${moved}.`
  return `Synced with Linear: ${moved}, ${outcome.warnings.length} ${outcome.warnings.length === 1 ? 'warning' : 'warnings'}: ${outcome.warnings.join(' ')}`
}

const worker = createWorker(realDeps())
export default worker.default
export const deactivate = worker.deactivate
