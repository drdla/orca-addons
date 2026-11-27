// Which Review Workspace the user is in: the card of that review is highlighted, so with several
// cards on screen it is clear which review the workspace belongs to. Orca's `workspace.changed`
// names the focused workspace by host id; the worker maps that to its path (`workspace.list` is
// worker-only), and cards match their Review Workspace by path.
import { atom, on, plugin, read, set, type BoxProps, type PanelContext } from 'orca'
import type { ReviewWorkspaceView } from './protocol'

/** The focused workspace's path, or null when none is focused (or Orca doesn't list it). */
const focusedPath = atom<string | null>(null)

/** Bumped on each focus change, so an older answer can't overwrite a newer one. */
let latest = 0

export function setupFocusedWorkspace(ctx: PanelContext): void {
  ctx.subscriptions.push(
    on('workspace.changed', ({ context }) => {
      const asked = ++latest
      const workspaceId = context?.workspaceId
      if (workspaceId === undefined) {
        set(focusedPath, null)
        return
      }
      plugin
        .request('rr.workspacePath', { workspaceId })
        .then(({ path }) => {
          if (asked === latest) set(focusedPath, path)
        })
        .catch(() => {
          if (asked === latest) set(focusedPath, null)
        })
    })
  )
}

/** True when the user is in this Review Workspace now. */
export function isFocused(workspace: ReviewWorkspaceView | null | undefined): boolean {
  const path = read(focusedPath)
  return workspace != null && path !== null && workspace.path === path
}

/** A card's frame: the hairline border, or an accent border and tint on the focused review's card. */
export function cardFrame(workspace: ReviewWorkspaceView | null | undefined): Pick<BoxProps, 'border' | 'background'> {
  return isFocused(workspace) ? { border: 'accent', background: 'accent' } : { border: true }
}
