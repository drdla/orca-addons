// The Review Workspace panel requests (#27, #28): Start review, Open workspace, Run Agent Review,
// Update workspace (#57), and the Ended tab's removal check and Remove workspace, plus Orca's
// `workspace.removed` event.
// worker.ts calls registerWorkspaceRequests once in activate.
import type { OrcaWorkerApi } from 'orca/worker'
import { coverPageTargetOf, createCoverPages } from '../cover-page/cover-pages'
import { messageOf } from '../errors'
import type { EndedWorkspaces } from '../ended/ended-workspaces'
import type { ReviewRequestsSnapshot, ReviewRequestView } from '../protocol'
import type { Disposable } from '../seams/clock'
import type { Files } from '../seams/files'
import type { GitLabAccess } from '../seams/gitlab'
import type { Settings } from '../settings'
import { hostWorkspaceIdOf } from './host-workspace'
import { createReviewActions, type WorkspaceUpdate } from './review-actions'
import type { WorkspaceContext } from './workspace-context'
import type { WorkspaceHeads } from './workspace-heads'

export function registerWorkspaceRequests(
  orca: OrcaWorkerApi,
  options: {
    context: WorkspaceContext
    ended: EndedWorkspaces
    settings: () => Promise<Settings>
    /** The listed Review Request with this URL, if any. */
    reviewRequest: (url: string) => ReviewRequestView | undefined
    snapshot: () => Promise<ReviewRequestsSnapshot>
    /** Tells open panels the snapshot changed. */
    postChanged: () => Promise<void>
    /** Writing the Review Cover Page (#55). */
    files: Files
    gitLab: () => Promise<GitLabAccess>
    /** Which Review Workspaces are behind their merge request (#57). */
    heads: WorkspaceHeads
    /**
     * Update workspace moved a Review Workspace (#58), also when a later step of it then failed.
     * A rejection is logged: the workspace did move, so it only costs the outdated flags.
     */
    onMoved?: (update: WorkspaceUpdate) => Promise<void>
  }
): Disposable {
  const { context, ended } = options
  const coverPages = createCoverPages({ git: context.git, files: options.files, host: context.host, gitLab: options.gitLab })
  const reviewActions = createReviewActions({
    ...context,
    settings: options.settings,
    reviewRequest: options.reviewRequest,
    coverPages,
    heads: options.heads,
    onMoved: async (update) => {
      try {
        await options.onMoved?.(update)
      } catch (error) {
        context.log(`Review Draft after Update workspace of ${update.url} failed: ${messageOf(error)}`)
      }
    }
  })

  /** Runs a workspace change; open panels hear of it even when it fails. Answers the snapshot. */
  async function changing(action: () => Promise<void>): Promise<ReviewRequestsSnapshot> {
    try {
      await action()
    } finally {
      await options.postChanged()
    }
    return options.snapshot()
  }

  orca.panels.handle('rr.startReview', async ({ url, withAgent }) =>
    changing(() => reviewActions.startReview(url, withAgent))
  )
  orca.panels.handle('rr.openWorkspace', async ({ url }) => {
    if (ended.has(url)) {
      // An Ended Review Request is off the list; open its workspace by path (#28).
      const entry = ended.entry(url)
      const workspaceId = await hostWorkspaceIdOf(orca.host, entry.workspace)
      await orca.host.call('workspace.open', { workspaceId })
      await coverPages.openIfMissing(coverPageTargetOf(entry, entry.workspace))
    } else {
      await reviewActions.openWorkspace(url)
    }
    return { opened: true as const }
  })
  // The Review Draft's "Cover page" (#55), also for an Ended Review Request's workspace.
  orca.panels.handle('rr.openCoverPage', async ({ url }) => {
    if (ended.has(url)) {
      const entry = ended.entry(url)
      await orca.host.call('workspace.open', { workspaceId: await hostWorkspaceIdOf(orca.host, entry.workspace) })
      await coverPages.open(coverPageTargetOf(entry, entry.workspace))
    } else {
      await reviewActions.openCoverPage(url)
    }
    return { opened: true as const }
  })
  // The In review card's Changed files button.
  orca.panels.handle('rr.showChanges', async ({ url }) => {
    await reviewActions.showChanges(url)
    return { opened: true as const }
  })
  // "Update workspace" (#57). Which Review Comments may be outdated is worked out against the
  // workspace's HEAD whenever the Review Draft is imported (#58); the update only hands over the
  // head it left (onMoved, as soon as HEAD moved), so what was written before it keeps that commit.
  orca.panels.handle('rr.updateWorkspace', async ({ url }) =>
    changing(async () => {
      await reviewActions.updateWorkspace(url)
    })
  )
  orca.panels.handle('rr.runAgentReview', async ({ url }) => {
    await reviewActions.runAgentReview(url)
    return { started: true as const }
  })
  orca.panels.handle('rr.checkRemoval', async ({ url }) => ended.checkRemoval(url))
  orca.panels.handle('rr.removeWorkspace', async ({ url, force }) => changing(() => ended.remove(url, force)))

  // A workspace removed anywhere (here, in Orca, by the CLI): its Ended entry goes (#7).
  return orca.events.on('workspace.removed', async ({ path }) => {
    await context.workspaces.refresh()
    await ended.onWorkspaceRemoved(path)
    await options.postChanged()
  })
}
