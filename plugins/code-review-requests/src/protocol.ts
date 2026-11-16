// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

/** One Review Request as the panel shows it. Later slices add fields (CI, approvals, workspace…). */
export type ReviewRequestView = {
  /** The MR web URL: the Review Request's identity everywhere in the plugin. */
  url: string
  title: string
  projectPath: string
  iid: number
  author: string
  /** When the user was added as Reviewer (ms): when the Review Request started waiting. */
  requestedAt: number
  /** The MR's branches, for the Review Prompt (#27); absent in views stored before #27. */
  sourceBranch?: string
  targetBranch?: string
}

/** A Review Workspace (#27): the Orca workspace linked to a Review Request's MR. */
export type ReviewWorkspaceView = {
  /** The orca CLI's worktree id, `<repoId>::<path>`. */
  id: string
  name: string
  path: string
}

/** A Review Request as the panel draws it: the view plus what the worker derives for it. */
export type ReviewRequestCard = ReviewRequestView & {
  /** Waiting longer than the "Overdue after" setting, counting working days only (#22). */
  overdue: boolean
  /** Its Review Workspace, or null (#27). Cards with one go under In review. */
  workspace?: ReviewWorkspaceView | null
  /** Why Start review can't run for it (no Orca repo, the orca CLI is broken), or null (#27). */
  startBlocked?: string | null
}

export type ReviewRequestsSnapshot = {
  /** Longest waiting first. */
  reviewRequests: ReviewRequestCard[]
  /** When the last successful poll started (ms), or null if none has. */
  refreshedAt: number | null
}

declare module 'orca' {
  interface PluginRequests {
    /** The worker's current view of the Review Requests. */
    'rr.snapshot': { output: ReviewRequestsSnapshot }
    /** Polls now, then answers like rr.snapshot. */
    'rr.refresh': { output: ReviewRequestsSnapshot }
    /** Puts a Review Request's link on the clipboard (panels have no clipboard API). */
    'rr.copyLink': { input: { url: string }; output: { copied: true } }
    /**
     * Creates the Review Workspace for a Review Request through the orca CLI, linked to its MR,
     * then starts an Agent Review in it if `withAgent` (#27). Answers the new snapshot.
     */
    'rr.startReview': { input: { url: string; withAgent: boolean }; output: ReviewRequestsSnapshot }
    /** Shows a Review Request's Review Workspace in Orca. */
    'rr.openWorkspace': { input: { url: string }; output: { opened: true } }
    /** Starts an Agent Review in a Review Request's existing Review Workspace. */
    'rr.runAgentReview': { input: { url: string }; output: { started: true } }
  }
  interface PluginPanelEvents {
    /** The worker's new snapshot, after every poll. */
    'rr.changed': ReviewRequestsSnapshot
  }
}
