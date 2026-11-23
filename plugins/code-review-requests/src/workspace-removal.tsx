// Remove workspace, as the panel offers it: on a Done card (#28) and on a review in progress
// (#80). It removes at once, without asking, forced: uncommitted changes, open terminals, running
// agents and the Review Draft go with it. On failure the card shows Orca's error. Both cards share
// this state, so they look and behave the same.
import { atom, plugin, read, Stack, Text, update } from 'orca'
import { messageOf } from './errors'
import type { ReviewRequestsSnapshot } from './protocol'

/** Cards with a removal under way. */
const busy = atom<Record<string, true>>({})
/** Per-card errors of the removal. */
const errors = atom<Record<string, string>>({})

function patch<T>(store: typeof busy | typeof errors, url: string, value: T | null): void {
  update(store as never, (all: Record<string, T>) => {
    const next = { ...all }
    if (value === null) delete next[url]
    else next[url] = value
    return next
  })
}

/** Removing a workspace waits for Orca's own checks; 120 s is a panel request's maximum. */
const REMOVE_TIMEOUT_MS = 120_000

/** A removal is under way for this card. */
export function isRemoving(url: string): boolean {
  return read(busy)[url] === true
}

/** Remove workspace: removes it right away and hands the worker's new snapshot to `received`. */
export function removeWorkspace(url: string, received: (snapshot: ReviewRequestsSnapshot) => void): void {
  patch(busy, url, true)
  patch(errors, url, null)
  plugin
    .request('rr.removeWorkspace', { url }, { timeoutMs: REMOVE_TIMEOUT_MS })
    .then(received)
    .catch((error: unknown) => patch(errors, url, `Couldn't remove the workspace: ${messageOf(error)}`))
    .finally(() => patch(busy, url, null))
}

/** Why the last removal failed for this card; nothing otherwise. */
export function RemovalError(props: { url: string }) {
  const error = read(errors)[props.url]
  if (error === undefined) return null
  return (
    <Stack gap="xs">
      <Text tone="danger" size="xs">
        {error}
      </Text>
    </Stack>
  )
}
