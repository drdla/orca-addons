// The plugin's worker: gathers the sync's inputs through the orca CLI, runs the pure sync
// (src/sync/sync.ts), applies the Linear writes and card moves, and persists the memory. Orca transpiles this file
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
import { forgetFailedWrite, isDrag, revertFailedMove, syncBoard, ticketsToFetch, type LinearTeam, type Ticket } from './sync/sync'
import { counted } from './words'

export const SYNC_NOW_COMMAND = 'linear-board-sync.syncNow'
export const PAUSE_COMMAND = 'linear-board-sync.pause'

const MINUTE = 60_000
/** How often the board is checked for drags; the Linear poll keeps its own interval. */
const BOARD_CHECK_MS = 15_000
/**
 * The board check's tick. Shorter than its interval: a tick that lands a hair before the check is
 * due would otherwise skip a whole 15 s period.
 */
const BOARD_CHECK_TICK_MS = 5_000

type SyncMode = { kind: 'poll' } | { kind: 'board-check' } | { kind: 'created'; path: string }

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
    /** What the status bar lists: the last poll's warnings, plus any board check or new workspace's since. */
    let shownWarnings: string[] = []
    /** The settings that could not be read, as of the last read; listed first in the status bar. */
    let settingsProblems: string[] = []
    /** When a sync last drew the status bar, or null before the first. */
    let syncedAt: number | null = null
    /** The Linear teams as last read. */
    let knownTeams: LinearTeam[] | null = null

    /** Syncs run one at a time, so two never move the same card or race on the memory. */
    let queue: Promise<unknown> = Promise.resolve()
    function serially<T>(task: () => Promise<T>): Promise<T> {
      const next = queue.then(task)
      queue = next.catch(() => {})
      return next
    }

    /**
     * One sync. A `poll` reads every Linked Workspace's ticket; a `board-check` reads only the tickets
     * of dragged cards, and does nothing more when there are none; `created` reads the one new workspace's.
     */
    /**
     * Reads the settings afresh, so a change applies from the next tick without a restart: the
     * poll interval at once, the rest at the next sync. A problem is logged when it first appears.
     */
    async function readSettings() {
      const parsed = parseSettings(await orca.settings.get())
      poller.setIntervalMs(parsed.pollMinutes * MINUTE)
      for (const problem of parsed.problems) {
        if (!settingsProblems.includes(problem)) log(`warning: ${problem}`)
      }
      settingsProblems = parsed.problems
      return parsed
    }

    function syncedStatus(): SyncStatus {
      if (paused) return { kind: 'paused' }
      return { kind: 'synced', at: syncedAt ?? clock.now(), warnings: [...settingsProblems, ...shownWarnings] }
    }

    async function sync(mode: SyncMode): Promise<SyncOutcome> {
      const parsed = await readSettings()
      const warnings: string[] = []
      let moved = 0
      try {
        const board = await cli.board()
        const before = await memoryStore.load()
        const scope =
          mode.kind === 'poll'
            ? board
            : mode.kind === 'created'
              ? board.filter((card) => card.path === mode.path)
              : board.filter((card) => isDrag(card, before))
        if (mode.kind === 'board-check' && scope.length === 0) return { moved, warnings: parsed.problems }
        // The board check reuses the teams of the last read, so a quiet board costs one `orca` call.
        if (mode.kind !== 'board-check' || knownTeams === null) knownTeams = await cli.linearTeams()
        const teams = knownTeams
        const tickets: Ticket[] = []
        for (const ref of ticketsToFetch({ teams, board: scope, settings: parsed.settings })) {
          try {
            tickets.push(await cli.ticket(ref))
          } catch (error) {
            warnings.push(`${ref.identifier}: couldn't read the ticket: ${messageOf(error)}`)
          }
        }
        // The whole board goes in: cards whose ticket wasn't read keep their memory.
        const result = syncBoard({
          linear: { teams, tickets },
          board,
          memory: before,
          settings: parsed.settings,
          created: mode.kind === 'created' ? mode.path : null
        })
        warnings.push(...result.warnings)
        const memory = result.memory
        // Linear writes first, in order; a failed one skips that ticket's later writes and its card move.
        const failedPaths = new Set<string>()
        for (const write of result.writes) {
          if (failedPaths.has(write.path)) continue
          try {
            if (write.kind === 'assign-me') await cli.assignToMe(write.ref)
            else await cli.setState(write.ref, write.state)
          } catch (error) {
            const what = write.kind === 'assign-me' ? 'assign it to you' : `set it to "${write.state}"`
            warnings.push(
              `${write.ref.identifier}: couldn't ${what} in Linear; the card follows Linear at the next poll: ${messageOf(error)}`
            )
            failedPaths.add(write.path)
            forgetFailedWrite(memory, write.path)
          }
        }
        for (const move of result.moves.filter((m) => !failedPaths.has(m.path))) {
          try {
            await cli.setColumn(move.worktreeId, move.to)
            moved++
          } catch (error) {
            // Skipped, not retried: the next sync tries again, once.
            warnings.push(`${move.identifier}: couldn't move the card to "${move.to}": ${messageOf(error)}`)
            revertFailedMove(memory, before, move.path)
          }
        }
        await memoryStore.save(memory)
      } catch (error) {
        warnings.push(`Couldn't sync: ${messageOf(error)}`)
      }
      for (const warning of warnings) log(`warning: ${warning}`)
      // A poll replaces what the status bar shows; a board check or a new workspace adds to it until then.
      shownWarnings = mode.kind === 'poll' ? warnings : [...new Set([...shownWarnings, ...warnings])]
      syncedAt = clock.now()
      await statusBar.render(syncedStatus())
      return { moved, warnings: [...parsed.problems, ...warnings] }
    }

    const poller = createPoller({
      clock,
      intervalMs: 2 * MINUTE,
      poll: async () => {
        await serially(() => sync({ kind: 'poll' }))
      }
    })
    const boardCheck = createPoller({
      clock,
      intervalMs: BOARD_CHECK_MS,
      tickMs: BOARD_CHECK_TICK_MS,
      poll: async () => {
        await serially(() => sync({ kind: 'board-check' }))
      }
    })

    async function render(status: SyncStatus): Promise<void> {
      await statusBar.render(status).catch((error: unknown) => log(`status bar: ${messageOf(error)}`))
    }

    async function startIfConfigured(): Promise<void> {
      if (paused || poller.running || !isConfigured(await orca.settings.get())) return
      await render({ kind: 'starting' })
      // The Linear poll first, so the board check finds the teams read and every card placed.
      poller.start()
      boardCheck.start()
    }

    orca.events.on('workspace.created', async ({ path }) => {
      if (paused || !poller.running) return
      await serially(() => sync({ kind: 'created', path }))
    })
    orca.events.on('workspace.removed', async ({ path }) => {
      await serially(() => memoryStore.forget(path))
    })

    orca.commands.register(SYNC_NOW_COMMAND, async () => {
      if (paused) return 'Linear Board Sync is paused. Run "Linear Board Sync: Pause" again to resume.'
      if (!poller.running) return 'Linear Board Sync is not set up yet.'
      return summary(await serially(() => sync({ kind: 'poll' })))
    })
    orca.commands.register(PAUSE_COMMAND, async () => {
      if (!paused) {
        paused = true
        poller.stop()
        boardCheck.stop()
        await render({ kind: 'paused' })
        return 'Linear Board Sync paused. Run "Linear Board Sync: Pause" again to resume.'
      }
      paused = false
      // Resuming forgets every card, so drags made while paused are discarded and Linear re-applied.
      await serially(() => memoryStore.save({}))
      await startIfConfigured()
      if (poller.running) await poller.pollNow()
      return 'Linear Board Sync resumed.'
    })

    /** A settings change: start if now configured; once running, re-read and redraw the status bar's settings problems. */
    async function settingsChanged(): Promise<void> {
      await startIfConfigured()
      if (!poller.running) return
      await readSettings()
      if (syncedAt !== null) await render(syncedStatus())
    }

    const settingsWatch = orca.settings.onDidChange(() =>
      settingsChanged().catch((error: unknown) => log(`settings: ${messageOf(error)}`))
    )
    stopWorker = () => {
      settingsWatch.dispose()
      poller.stop()
      boardCheck.stop()
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
  const moved = `${counted(outcome.moved, 'card')} moved`
  if (outcome.warnings.length === 0) return `Synced with Linear: ${moved}.`
  return `Synced with Linear: ${moved}, ${counted(outcome.warnings.length, 'warning')}: ${outcome.warnings.join(' ')}`
}

const worker = createWorker(realDeps())
export default worker.default
export const deactivate = worker.deactivate
