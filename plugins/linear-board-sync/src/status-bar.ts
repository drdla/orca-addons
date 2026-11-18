// The status bar item: whether sync is running, paused, or has warnings (a failed card move, a
// ticket or Linear that couldn't be read, a setting that couldn't be parsed).
import type { OrcaWorkerApi } from 'orca/worker'
import { counted } from './words'

export const STATUS_BAR_ID = 'linear-board-sync'

export type SyncStatus =
  | { kind: 'starting' }
  | { kind: 'paused' }
  | { kind: 'synced'; at: number; warnings: string[] }

type Look = { text: string; icon: 'refresh' | 'pause' | 'warning'; tone: 'neutral' | 'warning'; tooltip: string; visible: true }

/** At most this many warnings are listed in the tooltip. */
const LISTED = 5

export function lookOf(status: SyncStatus): Look {
  if (status.kind === 'paused') {
    return { text: 'Linear: paused', icon: 'pause', tone: 'neutral', visible: true,
      tooltip: 'Linear Board Sync is paused. Run "Linear Board Sync: Pause" again to resume.' }
  }
  if (status.kind === 'starting') {
    return { text: 'Linear', icon: 'refresh', tone: 'neutral', visible: true, tooltip: 'Linear Board Sync: starting.' }
  }
  const at = clockTime(status.at)
  if (status.warnings.length === 0) {
    return { text: 'Linear', icon: 'refresh', tone: 'neutral', visible: true,
      tooltip: `Linear Board Sync: board in step with Linear (synced ${at}). Click to sync now.` }
  }
  const count = status.warnings.length
  const listed = status.warnings.slice(0, LISTED).map((w) => `• ${w}`)
  if (count > LISTED) listed.push(`• and ${count - LISTED} more (see the plugin log)`)
  return {
    text: `Linear: ${counted(count, 'warning')}`,
    icon: 'warning',
    tone: 'warning',
    visible: true,
    tooltip: [`Linear Board Sync (synced ${at}):`, ...listed].join('\n')
  }
}

/** Draws the look for each status, skipping the host call when nothing changed. */
export function createStatusBar(orca: Pick<OrcaWorkerApi, 'host'>) {
  let drawn: string | null = null
  return {
    async render(status: SyncStatus): Promise<void> {
      const look = lookOf(status)
      const key = JSON.stringify(look)
      if (key === drawn) return
      await orca.host.call('statusBar.update', { id: STATUS_BAR_ID, ...look })
      drawn = key
    }
  }
}

function clockTime(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
