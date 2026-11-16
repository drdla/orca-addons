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

/** Why a Review Request ended (#28); a Review Request made draft is not Ended. */
export type EndedReason = 'approved' | 'merged' | 'closed' | 'unassigned' | 'gone'

/** An Ended Review Request that still has its Review Workspace (#7, #28): the Ended tab's cards. */
export type EndedCard = ReviewRequestView & {
  reason: EndedReason
  /** When the plugin first saw it end (ms); auto-removal counts from here. */
  endedAt: number
  workspace: ReviewWorkspaceView
  /** Why auto-removal skipped it last time (uncommitted changes, something running…), or null. */
  autoRemoveSkipped: string | null
}

/** What removing a Review Workspace would lose (#28), for the confirmation. */
export type RemovalCheck = {
  /** One line each, for example "2 uncommitted changes". Empty when it's clean. */
  problems: string[]
  /** True when removal needs `--force` (uncommitted changes, something running). */
  force: boolean
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
  /** Ended Review Requests with a Review Workspace, most recently ended first (#28). Absent means none. */
  ended?: EndedCard[]
  /** Why the orca CLI can't list workspaces, while it can't (#15): workspace actions are off. */
  workspacesUnavailable?: string
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

/**
 * The panel's Connection section (#8, #25): which source reaches GitLab and what it may do. It
 * never carries the token itself.
 */
export type ConnectionView = {
  /** False until the settings hold an instance URL; then nothing else is checked. */
  configured: boolean
  /** The configured host, or null when the instance URL isn't one. */
  host: string | null
  /** A token stored for `host` means token mode; otherwise glab. */
  source: 'glab' | 'token'
  /** The signed-in GitLab user, or null when the check failed. */
  user: string | null
  /** The token's scopes, or null when GitLab didn't say (glab with an OAuth login). */
  scopes: string[] | null
  /** Can list Review Requests (`read_api` or `api`); null when not checked. */
  canList: boolean | null
  /** Can post a review (`api`); null when unknown, which is treated as allowed. */
  canPost: boolean | null
  /** `unavailable`: no OS key store, so tokens cannot be saved and only glab works. */
  tokenStorage: 'os-keyring' | 'unavailable'
  /** Why the check failed, or null. */
  problem: string | null
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
    /** Shows a Review Request's (or an Ended Review Request's) Review Workspace in Orca. */
    'rr.openWorkspace': { input: { url: string }; output: { opened: true } }
    /** Starts an Agent Review in a Review Request's existing Review Workspace. */
    'rr.runAgentReview': { input: { url: string }; output: { started: true } }
    /** What removing an Ended Review Request's Review Workspace would lose (#28). */
    'rr.checkRemoval': { input: { url: string }; output: RemovalCheck }
    /**
     * Removes an Ended Review Request's Review Workspace (`orca worktree rm --delete-branch`, plus
     * `--force` only when `force`, after the person confirmed). Answers the new snapshot.
     */
    'rr.removeWorkspace': { input: { url: string; force: boolean }; output: ReviewRequestsSnapshot }
    /** The Connection section (#25). `test` re-checks the user and scopes instead of the cached answer. */
    'rr.connection': { input: { test: boolean }; output: ConnectionView }
    /**
     * Validates a token and stores it for the configured host only if it works with `read_api`;
     * `error` says why it wasn't stored. Polling switches to it at once.
     */
    'rr.saveToken': { input: { token: string }; output: { connection: ConnectionView; error: string | null } }
    /** Deletes the token for the configured host: back to glab, polling at once. */
    'rr.removeToken': { output: ConnectionView }
  }
  interface PluginPanelEvents {
    /** The worker's new snapshot, after every poll. */
    'rr.changed': ReviewRequestsSnapshot
  }
}
