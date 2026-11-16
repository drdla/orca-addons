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
  /** The CI badge (#10): the head pipeline's outcome, or null without one (or canceled, skipped…). */
  ci?: CiStatus | null
  /** The approvals badge, `given/required`; null when the MR requires none. */
  approvals?: { given: number; required: number } | null
  /** The comments badge: comments by people on the MR. */
  comments?: number
}

export type CiStatus = 'passed' | 'failed' | 'running'

/** An Agent Review in a Review Workspace (#10), from `orca worktree ps`. */
export type AgentReviewView = {
  /** An agent is working (or waiting for permission), or every agent has finished its turn. */
  state: 'running' | 'done'
  /** Review Comments in the Review Draft that aren't posted yet. */
  commentsReady: number
}

/** A Review Workspace (#27): the Orca workspace linked to a Review Request's MR. */
export type ReviewWorkspaceView = {
  /** The orca CLI's worktree id, `<repoId>::<path>`. */
  id: string
  name: string
  path: string
}

/** Why a Review Request ended (#28); a Review Request made draft is not Ended. */
export type EndedReason = 'approved' | 'merged' | 'closed' | 'unassigned'

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
  /** Appeared since the panel was opened before this time (#10): the New badge and accent border. */
  isNew?: boolean
  /** The Agent Review in its Review Workspace, or null when no agent ran there (#10). */
  agentReview?: AgentReviewView | null
  /** Checked, unposted Review Comments in its Review Draft: "Post N to GitLab" on the card (#10). */
  toPost?: number
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
      /**
       * While glab is logged out of `host`: the other hosts it is logged in to, each offered as
       * "Use <host>" (#8). Absent or empty means none.
       */
      glabHosts?: string[]
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
  /** Why the last post couldn't publish it (its draft is left on GitLab), if it failed (#30). */
  failure?: string
}

/** How the review is submitted (#14, #30): its reviewer state. */
export type ReviewOutcome = 'comment' | 'requested_changes' | 'approve'

/** A draft note already pending on GitLab, which publishing the review publishes too. */
export type LeftoverDraftView = { id: number; body: string }

/** The confirm step before posting a Review Draft (#30). */
export type PostPreview = {
  url: string
  /** How many checked, unposted Review Comments post. */
  comments: number
  /** My other pending GitLab drafts on the MR (started in the browser, say); they publish too. */
  leftoverDrafts: LeftoverDraftView[]
  /** One line each: older MR versions, comments that post as general comments, failed drafts replaced. */
  warnings: string[]
}

/** What posting did (#30). */
export type PostResult = {
  /** Review Comments now on GitLab. */
  posted: number
  /** Review Comments whose draft GitLab kept unpublished; they stay in the Review Draft. */
  failed: { commentId: string; location: string; message: string }[]
  /** Why Approve didn't go through (the review itself is posted), or null. */
  approveError: string | null
  draft: ReviewDraftView
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
    /** Puts any text on the clipboard, such as the setup checklist's glab login command (#8). */
    'rr.copyText': { input: { text: string }; output: { copied: true } }
    /**
     * The panel was opened (#10): its Review Requests count as seen for the bell's "M new", and
     * at the next opening they lose the New badge.
     */
    'rr.markSeen': { output: { seen: true } }
    /**
     * The setup checklist's "Use <host>" (#8): points the instance URL setting at `host` (one glab
     * is logged in to) and polls it at once. Answers the new snapshot.
     */
    'rr.useHost': { input: { host: string }; output: ReviewRequestsSnapshot }
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
    /** The confirm step: what posting the Review Draft would send and publish (#30). Reads GitLab only. */
    'rr.postPreview': { input: { url: string }; output: PostPreview }
    /**
     * Posts the checked, unposted Review Comments as one GitLab review with a summary and an
     * outcome, approving too for `approve`, then re-lists and retries what failed (#30).
     */
    'rr.postReview': {
      input: { url: string; summary: string; outcome: ReviewOutcome }
      output: PostResult
    }
    /** Deletes the drafts the last post left on GitLab; their Review Comments stay in the draft (#30). */
    'rr.deleteFailedDrafts': { input: { url: string }; output: ReviewDraftView }
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
