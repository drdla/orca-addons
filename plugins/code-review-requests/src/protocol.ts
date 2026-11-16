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
}

export type ReviewRequestsSnapshot = {
  reviewRequests: ReviewRequestView[]
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

declare module 'orca' {
  interface PluginRequests {
    /** The worker's current view of the Review Requests. */
    'rr.snapshot': { output: ReviewRequestsSnapshot }
    /** Polls now (the panel's Retry / Check again) and answers with the new snapshot. */
    'rr.retry': { output: ReviewRequestsSnapshot }
  }
}
