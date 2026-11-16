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
  /** How many Review Requests the filter settings hide (#26). Absent means none. */
  hiddenByFilters?: number
  /** Filter setting entries that are not valid rules and are ignored (#26). Absent means none. */
  invalidFilterEntries?: string[]
  /** Why the last poll failed (#24); absent while polling works. */
  gitlab?: GitLabProblemView
}

/** Which setup step is missing; mirrors NeedsYouReason in src/seams/gitlab.ts. */
export type SetupReason = 'glab-missing' | 'logged-out' | 'token-rejected' | 'gitlab-too-old' | 'bad-url'

export type GitLabProblemView =
  | {
      /** Polling stopped until the user fixes something; the panel shows the setup checklist. */
      status: 'needs-you'
      reason: SetupReason
      /** The configured host, or null when the instance URL isn't one. */
      host: string | null
      /** The GitLab version, when it's too old. */
      version: string | null
      /** The raw error, for the Details disclosure. */
      message: string
    }
  | {
      /** The last poll failed transiently; the list is the last good one and a retry is due. */
      status: 'retrying'
      message: string
      lastSuccessAt: number | null
      /** When the next poll is due, or null if none is scheduled. */
      retryAt: number | null
      /** "HH:MM" while GitLab rate-limits us (Retry is disabled until then), else null. */
      rateLimitedUntil: string | null
      /** True once the last good poll is older than 2× the interval: the status bar says offline. */
      offline: boolean
    }

/** One Review Comment in a Review Draft, as the panel shows it (#29). */
export type ReviewCommentView = {
  /** `note:<Orca note id>` or `finding:<hash of what the Agent Review wrote>`. */
  id: string
  /** An Orca diff-view note (read-only here: edit it in Orca) or an Agent Finding (editable). */
  origin: 'diff-note' | 'agent-finding'
  /** Relative to the workspace; null for a general comment. */
  filePath: string | null
  /** The new-file line, or null for a general comment; startLine is set for a range. */
  line: number | null
  startLine?: number
  body: string
  /** Kept for posting. Diff-view notes start checked, Agent Findings unchecked. */
  checked: boolean
  /** True for Agent Findings that aren't posted yet. */
  editable: boolean
  /** The commit the comment was made against, or null if unknown. */
  sha: string | null
  /** Posted to GitLab and not changed since. */
  posted: boolean
}

/** A Review Request's Review Draft (#29): what the drill-in panel view curates. */
export type ReviewDraftView = {
  url: string
  title: string
  workspace: ReviewWorkspaceView | null
  /** Diff-view notes first (in Orca's order), then Agent Findings (in the file's order). */
  comments: ReviewCommentView[]
  /** What the last import skipped or couldn't read, one line each. */
  warnings: string[]
  /** When the last import ran (ms), or null if never. */
  importedAt: number | null
}

declare module 'orca' {
  interface PluginRequests {
    /** The worker's current view of the Review Requests. */
    'rr.snapshot': { output: ReviewRequestsSnapshot }
    /**
     * Polls now (Refresh, and #24's Retry / Check again), then answers like rr.snapshot. While
     * GitLab rate-limits us it answers without polling.
     */
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
    /**
     * Imports the Review Request's diff-view notes and Agent Findings into its Review Draft, then
     * answers the draft (#29). Import is cheap and has no side effects outside plugin storage.
     */
    'rr.draft': { input: { url: string }; output: ReviewDraftView }
    /** Checks or unchecks a Review Comment, or edits an Agent Finding's body. */
    'rr.updateDraftComment': {
      input: { url: string; id: string; checked?: boolean; body?: string }
      output: ReviewDraftView
    }
  }
  interface PluginPanelEvents {
    /** The worker's new snapshot, after every poll. */
    'rr.changed': ReviewRequestsSnapshot
  }
}
