// Which Review Requests the user has seen in the panel (#10), per GitLab host, for the card's New
// badge and the bell's "M new".
//   - `seen` (stored as `seen:<host>`): the Review Requests listed when the panel was last opened.
//     The bell counts the ones not in it as new.
//   - Cards are New against what was seen before the current opening, so a New badge stays put
//     while the panel is open and goes at the next opening.
// The first good poll on a host counts as seen: nothing is New on a first run.
import type { ReviewRequestView } from './protocol'
import type { StatusBarRefiner } from './status-bar'

const KEY_PREFIX = 'seen:'

type Storage = { get(key: string): Promise<unknown>; set(key: string, value: never): Promise<void> }

type HostState = { seen: Set<string>; before: Set<string> }

export function createSeenTracker(storage: Storage) {
  const hosts = new Map<string, HostState>()

  async function stateOf(host: string): Promise<HostState | null> {
    if (!hosts.has(host)) {
      const stored = await storage.get(`${KEY_PREFIX}${host}`)
      if (!Array.isArray(stored)) return null
      const seen = new Set(stored.filter((url): url is string => typeof url === 'string'))
      hosts.set(host, { seen, before: seen })
    }
    return hosts.get(host)!
  }

  async function save(host: string, urls: string[], before: Set<string>): Promise<void> {
    hosts.set(host, { seen: new Set(urls), before })
    await storage.set(`${KEY_PREFIX}${host}`, urls as never)
  }

  return {
    /** Every good poll: the first one on a host counts as seen. */
    async onGoodPoll(host: string, reviewRequests: ReviewRequestView[]): Promise<void> {
      if ((await stateOf(host)) !== null) return
      const urls = reviewRequests.map((r) => r.url)
      await save(host, urls, new Set(urls))
    },

    /** The panel was opened showing these Review Requests. */
    async markSeen(host: string, reviewRequests: ReviewRequestView[]): Promise<void> {
      const before = (await stateOf(host))?.seen ?? new Set<string>()
      await save(host, reviewRequests.map((r) => r.url), before)
    },

    /** The card's New badge: appeared since the panel was opened before this time. */
    isNew(host: string | null, url: string): boolean {
      const state = host === null ? undefined : hosts.get(host)
      return state !== undefined && !state.before.has(url)
    },

    /** The bell's "M new": not listed when the panel was last opened. */
    unseen(host: string | null, reviewRequests: ReviewRequestView[]): number {
      const state = host === null ? undefined : hosts.get(host)
      return state === undefined ? 0 : reviewRequests.filter((r) => !state.seen.has(r.url)).length
    }
  }
}

export type SeenTracker = ReturnType<typeof createSeenTracker>

/** The bell's tooltip says how many are new: "5 Review Requests, 2 new. Click to open." (#10) */
export function seenRefiner(seen: SeenTracker): StatusBarRefiner {
  return (look, state) => {
    const unseen = seen.unseen(state.host, state.reviewRequests)
    if (unseen === 0) return look
    return { ...look, tooltip: look.tooltip.replace(/\. Click to open\.$/, `, ${unseen} new. Click to open.`) }
  }
}
