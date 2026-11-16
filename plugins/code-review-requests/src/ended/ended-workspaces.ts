// The Ended tab's entries and their Review Workspace removal (#7, #28).
//
// An entry is an Ended Review Request (approved, merged, closed, the user removed as Reviewer, or
// gone) that had a Review Workspace when the notifier explained why it dropped off. Made draft is
// never an entry. Entries live in orca.storage (ENDED_KEY) and stay until their workspace is gone:
// removed here, by auto-removal, or outside the plugin (the `workspace.removed` event, or missing
// from a later `orca worktree list`). One that becomes a Review Request again leaves the tab, which
// also cancels its auto-removal.
//
// Removal checks three things: uncommitted changes (`git status --porcelain`), running agents or
// open terminals (host `workspace.list {includeStatus}`), and unposted Review Comments (a hook
// #30 fills: `unpostedReviewComments`). Manual removal lists them for the confirmation and forces
// only for the first two; auto-removal never forces and skips (and retries next tick) on any.
import type { OrcaWorkerApi } from 'orca/worker'
import type { EndedCard, EndedReason, RemovalCheck, ReviewRequestView } from '../protocol'
import type { Clock } from '../seams/clock'
import type { Git } from '../seams/git'
import type { OrcaCli } from '../seams/orca-cli'
import { isEnded, type Dropped } from '../notify/changes'
import { findReviewWorkspace } from '../workspaces/review-workspaces'
import type { WorkspaceTracker } from '../workspaces/workspace-tracker'

export const ENDED_KEY = 'ended.entries'

const DAY = 24 * 60 * 60_000

type Storage = { get(key: string): Promise<unknown>; set(key: string, value: never): Promise<void> }

export type EndedWorkspacesDeps = {
  storage: Storage
  cli: () => OrcaCli
  git: Git
  host: OrcaWorkerApi['host']
  clock: Clock
  workspaces: WorkspaceTracker
  /** "Auto-remove ended Review Workspaces after (days)"; 0 turns auto-removal off. */
  autoRemoveDays: () => Promise<number>
  /**
   * How many Review Comments of this Review Request's Review Draft are not posted yet (#14, #30).
   * Any makes manual removal ask first and auto-removal skip. Until #30 wires it, none.
   */
  unpostedReviewComments?: (entry: EndedCard) => Promise<number>
  /** After its workspace is gone, whoever removed it (#30: discard the Review Draft). */
  onRemoved?: (entry: EndedCard) => void | Promise<void>
  log: (message: string) => void
}

export function createEndedWorkspaces(deps: EndedWorkspacesDeps) {
  let entries: EndedCard[] = []

  async function save(next: EndedCard[]): Promise<void> {
    entries = next
    await deps.storage.set(ENDED_KEY, next as never)
  }

  async function forget(gone: EndedCard[]): Promise<void> {
    if (gone.length === 0) return
    const urls = new Set(gone.map((e) => e.url))
    await save(entries.filter((e) => !urls.has(e.url)))
    for (const entry of gone) await deps.onRemoved?.(entry)
  }

  function entryOf(url: string): EndedCard {
    const entry = entries.find((e) => e.url === url)
    if (!entry) throw new Error('This Ended Review Request is no longer listed. Refresh and try again.')
    return entry
  }

  return {
    /** Reads the stored entries; call once before anything else. */
    async load(): Promise<void> {
      const stored = await deps.storage.get(ENDED_KEY)
      entries = Array.isArray(stored) ? (stored as EndedCard[]) : []
    },

    /** The Ended tab, most recently ended first. */
    entries(): EndedCard[] {
      return [...entries].sort((a, b) => b.endedAt - a.endedAt)
    },

    has(url: string): boolean {
      return entries.some((e) => e.url === url)
    },

    entry: entryOf,

    /** The notifier's explained drops: the Ended ones with a Review Workspace become entries. */
    async onDropped(dropped: Dropped[], at: number): Promise<void> {
      const state = deps.workspaces.current()
      if (state.kind !== 'listed') return
      const added: EndedCard[] = []
      for (const d of dropped) {
        if (!isEnded(d) || entries.some((e) => e.url === d.url)) continue
        const worktree = findReviewWorkspace(state.index, d)
        if (!worktree) continue
        const { reason, ...view } = d
        added.push({
          ...view,
          reason: reason as EndedReason,
          endedAt: at,
          workspace: { id: worktree.id, name: worktree.displayName, path: worktree.path },
          autoRemoveSkipped: null
        })
      }
      if (added.length > 0) await save([...entries, ...added])
    },

    /** A good poll's whole list: Review Requests on it again are no longer Ended. */
    async onListed(reviewRequests: ReviewRequestView[]): Promise<void> {
      const listed = new Set(reviewRequests.map((r) => r.url))
      const back = entries.filter((e) => listed.has(e.url))
      if (back.length > 0) await save(entries.filter((e) => !listed.has(e.url)))
    },

    /** Orca's `workspace.removed` event. Answers whether an entry went with it. */
    async onWorkspaceRemoved(path: string): Promise<boolean> {
      const gone = entries.filter((e) => e.workspace.path === path)
      await forget(gone)
      return gone.length > 0
    },

    /** What removing this entry's workspace would lose. */
    async checkRemoval(url: string): Promise<RemovalCheck> {
      return checkOf(entryOf(url))
    },

    /** Manual removal, after the person confirmed (`force` only when the check asked for it). */
    async remove(url: string, force: boolean): Promise<void> {
      const entry = entryOf(url)
      await deps.cli().removeWorktree(`id:${entry.workspace.id}`, { deleteBranch: true, ...(force ? { force } : {}) })
      await forget([entry])
      await deps.workspaces.refresh()
    },

    /**
     * Each poll tick: forgets entries whose workspace is gone, then removes the workspaces past
     * the deadline that are clean. Paused while the orca CLI can't list workspaces.
     */
    async tick(): Promise<boolean> {
      const state = deps.workspaces.current()
      if (state.kind !== 'listed') return false
      const before = JSON.stringify(entries)
      const ids = new Set(state.index.worktrees.map((w) => w.id))
      await forget(entries.filter((e) => !ids.has(e.workspace.id)))

      const days = await deps.autoRemoveDays()
      const now = deps.clock.now()
      let removed = false
      if (days > 0) {
        for (const entry of entries.filter((e) => now >= e.endedAt + days * DAY)) {
          removed = (await autoRemove(entry)) || removed
        }
      }
      if (removed) await deps.workspaces.refresh()
      return removed || JSON.stringify(entries) !== before
    }
  }

  /** Never forced: anything to lose, or a failed removal, is noted on the entry and retried. */
  async function autoRemove(entry: EndedCard): Promise<boolean> {
    let skipped: string | null
    try {
      const check = await checkOf(entry)
      if (check.problems.length > 0) {
        skipped = `Not removed automatically: ${check.problems.join(', ')}.`
      } else {
        await deps.cli().removeWorktree(`id:${entry.workspace.id}`, { deleteBranch: true })
        await forget([entry])
        return true
      }
    } catch (error) {
      skipped = `Automatic removal failed: ${messageOf(error)}`
    }
    deps.log(`auto-removal of ${entry.workspace.path} skipped: ${skipped}`)
    if (skipped !== entry.autoRemoveSkipped) {
      await save(entries.map((e) => (e.url === entry.url ? { ...e, autoRemoveSkipped: skipped } : e)))
    }
    return false
  }

  async function checkOf(entry: EndedCard): Promise<RemovalCheck> {
    const problems: string[] = []
    let force = false
    try {
      const changes = (await deps.git.statusPorcelain(entry.workspace.path)).length
      if (changes > 0) {
        problems.push(changes === 1 ? '1 uncommitted change' : `${changes} uncommitted changes`)
        force = true
      }
    } catch (error) {
      problems.push(`uncommitted changes unknown (${messageOf(error)})`)
      force = true
    }
    try {
      const { workspaces } = await deps.host.call('workspace.list', { includeStatus: true })
      const status = workspaces.find((w) => w.path === entry.workspace.path)?.status
      if (status?.state === 'working' || status?.state === 'permission') {
        problems.push('an agent is running')
        force = true
      } else if (status !== undefined && status.terminalCount > 0) {
        const n = status.terminalCount
        problems.push(n === 1 ? '1 open terminal' : `${n} open terminals`)
        force = true
      }
    } catch (error) {
      problems.push(`running terminals unknown (${messageOf(error)})`)
      force = true
    }
    let unposted = 0
    try {
      unposted = (await deps.unpostedReviewComments?.(entry)) ?? 0
    } catch (error) {
      problems.push(`unposted Review Comments unknown (${messageOf(error)})`)
    }
    if (unposted > 0) {
      problems.push(unposted === 1 ? '1 unposted Review Comment' : `${unposted} unposted Review Comments`)
    }
    return { problems, force }
  }
}

export type EndedWorkspaces = ReturnType<typeof createEndedWorkspaces>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
