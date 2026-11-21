// `orca plugin check` renders the panel once per scenario, each with the REAL worker on a fresh
// host (it activates once per scenario, so it must not call out until configured). Stub the
// panel's requests here so each state is deterministic; add a scenario per panel state.
// Never seed `settings.instanceUrl` in a scenario: the worker treats it as "configured" and the
// real worker would then poll GitLab through the real glab (src/worker.ts).
import { defineCheck, hostError } from 'orca/testing'
import type {
  ConnectionView,
  PostPreview,
  ReviewDraftView,
  ReviewRequestCard,
  ReviewRequestsSnapshot,
  SetupReason
} from './protocol'
import type { PostStep } from './review-post-view'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 16, 9, 0)

function card(iid: number, title: string, waitedHours: number, overdue = false): ReviewRequestCard {
  return {
    url: `https://gitlab.example.com/acme/api/-/merge_requests/${iid}`,
    title,
    projectPath: 'acme/api',
    iid,
    author: 'ada',
    requestedAt: NOW - waitedHours * HOUR,
    overdue
  }
}

const toReview: ReviewRequestsSnapshot = {
  reviewRequests: [card(12, 'Add login with SSO', 5), card(14, 'Fix flaky upload test', 1)],
  refreshedAt: NOW
}

const WORKSPACE = { id: 'repo-api::/wt/review-api-12', name: 'review-api-12', path: '/wt/review-api-12' }

/** One Review Request being reviewed (it has a Review Workspace), one still to start. */
const inReview: ReviewRequestsSnapshot = {
  reviewRequests: [
    { ...card(12, 'Add login with SSO', 5), workspace: WORKSPACE, startBlocked: null },
    { ...card(14, 'Fix flaky upload test', 1), workspace: null, startBlocked: null }
  ],
  refreshedAt: NOW
}

/** Start review can't run: no Orca repo for one project, the orca CLI broken for the other. */
const startBlocked: ReviewRequestsSnapshot = {
  reviewRequests: [
    { ...card(12, 'Add login with SSO', 5), workspace: null, startBlocked: 'Add acme/api to Orca to review here.' },
    {
      ...card(14, 'Fix flaky upload test', 1),
      workspace: null,
      startBlocked: 'Workspaces are unavailable: The orca CLI failed (exit 1): Orca is not running'
    }
  ],
  refreshedAt: NOW
}

/** Two Ended Review Requests with Review Workspaces (#28), one that auto-removal skipped. */
const ended: ReviewRequestsSnapshot = {
  ...toReview,
  ended: [
    {
      ...card(10, 'Bump the SDK', 30),
      reason: 'merged',
      endedAt: NOW - 2 * HOUR,
      workspace: { id: 'repo-api::/wt/review-api-10', name: 'review-api-10', path: '/wt/review-api-10' },
      autoRemoveSkipped: null
    },
    {
      ...card(11, 'Drop the legacy importer', 60),
      reason: 'unassigned',
      endedAt: NOW - 50 * HOUR,
      workspace: { id: 'repo-api::/wt/review-api-11', name: 'review-api-11', path: '/wt/review-api-11' },
      autoRemoveSkipped: 'Not removed automatically: 2 uncommitted changes, an agent is running.'
    }
  ]
}

const withOverdue: ReviewRequestsSnapshot = {
  reviewRequests: [card(9, 'Migrate billing to the new API', 72, true), ...toReview.reviewRequests],
  refreshedAt: NOW
}

/** Every Review Request overdue (#53): the heading shows only the danger count. */
const allOverdue: ReviewRequestsSnapshot = {
  reviewRequests: [card(9, 'Migrate billing to the new API', 72, true), card(8, 'Retire the v1 webhooks', 50, true)],
  refreshedAt: NOW
}

const DRAFT_URL = `https://gitlab.example.com/acme/api/-/merge_requests/12`

/** A curated Review Draft (#29): a note range, a posted note, an edited range finding, a general one. */
const reviewDraft: ReviewDraftView = {
  url: DRAFT_URL,
  title: 'Add login with SSO',
  workspace: WORKSPACE,
  comments: [
    {
      id: 'note:n1',
      origin: 'diff-note',
      filePath: 'src/auth/sso.ts',
      startLine: 40,
      line: 44,
      body: 'Why not reuse the session helper here?',
      checked: true,
      editable: false,
      sha: 'a1b2c3d',
      posted: false
    },
    {
      id: 'note:n2',
      origin: 'diff-note',
      filePath: 'src/auth/sso.ts',
      line: 12,
      body: 'Typo in the error message.',
      checked: true,
      editable: false,
      sha: 'a1b2c3d',
      posted: true
    },
    {
      id: 'finding:0f3a9c21',
      origin: 'agent-finding',
      filePath: 'src/auth/token.ts',
      line: 88,
      body: 'The token expiry is never checked, so an expired token is accepted.',
      checked: false,
      editable: true,
      sha: 'a1b2c3d',
      posted: false
    },
    {
      id: 'finding:77d0e412',
      origin: 'agent-finding',
      filePath: null,
      line: null,
      body: 'Consider splitting the SSO provider config into its own MR.',
      checked: true,
      editable: true,
      sha: 'a1b2c3d',
      posted: false
    }
  ],
  warnings: ['Agent Finding 3 skipped: no body.', '1 diff-view note on uncommitted changes skipped: GitLab only has committed code.'],
  importedAt: NOW
}

/** The Review Draft view is open on MR 12 (it stays open across reloads). */
const draftOpen = { plugin: { 'rr.tab': 'in', 'rr.draftUrl': DRAFT_URL } }

/** The confirm step before posting (#30): two comments, one of my browser drafts, a warning. */
const postPreview: PostPreview = {
  url: DRAFT_URL,
  comments: 2,
  leftoverDrafts: [{ id: 41, body: 'Nit: the README still mentions the old login flow.' }],
  warnings: ['The MR has new commits since 2 Review Comments were written: GitLab may show them as outdated.']
}

/** The draft view with the posting step (persisted, so check can show it) in a given state. */
function postStep(step: PostStep, extra: Record<string, unknown> = {}) {
  return { plugin: { ...draftOpen.plugin, 'rr.postStep': step, ...extra } }
}

/** reviewDraft after a post: the posted comments marked, a failed one flagged. */
function postedDraft(failedId: string | null): ReviewDraftView {
  return {
    ...reviewDraft,
    comments: reviewDraft.comments.map((c) =>
      c.id === failedId
        ? { ...c, failure: 'GitLab kept it as a draft: it did not publish.' }
        : c.checked
          ? { ...c, posted: true, editable: false }
          : c
    )
  }
}

function needsYou(reason: SetupReason, version: string | null = null): ReviewRequestsSnapshot {
  return {
    reviewRequests: [],
    refreshedAt: null,
    gitlab: {
      status: 'needs-you',
      reason,
      host: reason === 'bad-url' ? null : 'gitlab.example.com',
      version,
      message: `gitlab.example.com: ${reason}`
    }
  }
}

/** A failed poll over the last good list. */
function retrying(rateLimitedUntil: string | null, offline: boolean): ReviewRequestsSnapshot {
  return {
    ...toReview,
    gitlab: {
      status: 'retrying',
      message: 'gitlab.example.com: 503 Service Unavailable',
      lastSuccessAt: NOW - 14 * 60_000,
      retryAt: NOW + 60_000,
      rateLimitedUntil,
      offline
    }
  }
}

/** The Connection section's answer (#25); glab, signed in, scopes unknown, unless overridden. */
function connection(over: Partial<ConnectionView> = {}): ConnectionView {
  return {
    configured: true,
    host: 'gitlab.example.com',
    source: 'glab',
    user: 'me',
    scopes: null,
    canList: true,
    canPost: null,
    tokenStorage: 'os-keyring',
    problem: null,
    ...over
  }
}

/** The Settings view open (the gear next to Refresh). */
const settingsOpen = { plugin: { 'rr.settingsOpen': true } }

export default defineCheck({
  /** No stub: the real, unconfigured worker answers. */
  fresh: {},
  empty: { requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: null } } },
  /** The Manual view open (the ⓘ between Refresh and Settings). */
  manual: { requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: null } }, persisted: { plugin: { 'rr.manualOpen': true } } },
  // Failure states (#24): Needs you warns above the tabs; the setup checklist per Needs-you reason
  // is in the Settings view; the transient line sits above the tabs.
  listBrokenConnection: { requests: { 'rr.snapshot': needsYou('logged-out'), 'rr.connection': connection({ user: null }) } },
  setupLoggedOut: { requests: { 'rr.snapshot': needsYou('logged-out') }, persisted: settingsOpen },
  /** Logged out here, but glab is logged in to other hosts: "Use <host>" buttons (#8). */
  setupLoggedOutOtherHosts: {
    requests: {
      'rr.snapshot': (() => {
        const snapshot = needsYou('logged-out')
        return { ...snapshot, gitlab: { ...snapshot.gitlab!, glabHosts: ['gitlab.com', 'gitlab.other.com'] } }
      })()
    },
    persisted: settingsOpen
  },
  setupGlabMissing: { requests: { 'rr.snapshot': needsYou('glab-missing') }, persisted: settingsOpen },
  setupTokenRejected: {
    requests: {
      'rr.snapshot': needsYou('token-rejected'),
      'rr.connection': connection({ source: 'token', user: null, canList: false, problem: 'gitlab.example.com: 401 Unauthorized' })
    },
    persisted: settingsOpen
  },
  setupTooOld: { requests: { 'rr.snapshot': needsYou('gitlab-too-old', '17.2.0') }, persisted: settingsOpen },
  setupBadUrl: { requests: { 'rr.snapshot': needsYou('bad-url') }, persisted: settingsOpen },
  retrying: { requests: { 'rr.snapshot': retrying(null, false) } },
  offline: { requests: { 'rr.snapshot': retrying(null, true) } },
  rateLimited: { requests: { 'rr.snapshot': retrying('09:10', false) } },
  // The connection (#25): nothing in the list while healthy; the top of the Settings view.
  listHealthy: { requests: { 'rr.snapshot': toReview, 'rr.connection': connection() } },
  settingsHealthy: {
    requests: { 'rr.snapshot': toReview, 'rr.connection': connection() },
    settings: { pollMinutes: 10, authorBlocklist: 'renovate-bot' },
    persisted: settingsOpen
  },
  settingsSetupChecklist: {
    requests: { 'rr.snapshot': needsYou('glab-missing'), 'rr.connection': connection({ user: null, canList: false }) },
    persisted: settingsOpen
  },
  settingsInvalidFilters: {
    requests: { 'rr.snapshot': { ...toReview, invalidFilterEntries: ['acme//api'] }, 'rr.connection': connection() },
    settings: { pathAllowlist: 'acme//api' },
    persisted: settingsOpen
  },
  connectionTokenReadOnly: {
    requests: {
      'rr.snapshot': toReview,
      'rr.connection': connection({ source: 'token', scopes: ['read_api'], canList: true, canPost: false })
    },
    persisted: settingsOpen
  },
  /** The connection check fails while polls work: the warning above the tabs. */
  connectionProblem: {
    requests: {
      'rr.snapshot': toReview,
      'rr.connection': connection({ user: null, canList: null, problem: 'gitlab.example.com: 403 Forbidden' })
    }
  },
  connectionNoKeyStore: {
    requests: { 'rr.snapshot': toReview, 'rr.connection': connection({ tokenStorage: 'unavailable' }) },
    persisted: settingsOpen
  },
  workerDown: {
    requests: {
      'rr.snapshot': () => {
        throw hostError('unavailable', 'The worker is not running.')
      }
    }
  },
  /** The Todo tab with cards, none overdue. */
  toReview: { requests: { 'rr.snapshot': toReview } },
  /** An overdue card: danger border and badge, warning icon on the tab. */
  overdue: { requests: { 'rr.snapshot': withOverdue } },
  allOverdue: { requests: { 'rr.snapshot': allOverdue } },
  /** The person left the panel on In review, with nothing there. */
  inReviewTab: { requests: { 'rr.snapshot': toReview }, persisted: { plugin: { 'rr.tab': 'in' } } },
  /** In review: a card with a Review Workspace, Open workspace and Run Agent Review (#27). */
  inReview: { requests: { 'rr.snapshot': inReview }, persisted: { plugin: { 'rr.tab': 'in' } } },
  /** Todo next to a Reviewing card: Start review and its Agent Review button (#27). */
  startReview: { requests: { 'rr.snapshot': inReview } },
  /** Card badges (#10): New with its accent border, CI, approvals and comments. */
  cardBadges: {
    requests: {
      'rr.snapshot': {
        reviewRequests: [
          { ...card(12, 'Add login with SSO', 5), isNew: true, ci: 'failed', approvals: { given: 1, required: 2 }, comments: 3 },
          { ...card(14, 'Fix flaky upload test', 1), ci: 'running', approvals: null, comments: 1 },
          { ...card(9, 'Migrate billing to the new API', 72, true), isNew: true, ci: 'passed', comments: 0 }
        ],
        refreshedAt: NOW
      } satisfies ReviewRequestsSnapshot
    }
  },
  /** In review (#10): an Agent Review running, and one done with comments ready to post. */
  inReviewAgentReview: {
    requests: {
      'rr.snapshot': {
        reviewRequests: [
          { ...card(12, 'Add login with SSO', 5), workspace: WORKSPACE, startBlocked: null, agentReview: { state: 'done', commentsReady: 4 }, toPost: 3 },
          {
            ...card(14, 'Fix flaky upload test', 1),
            workspace: { ...WORKSPACE, id: 'repo-api::/wt/review-api-14', path: '/wt/review-api-14' },
            startBlocked: null,
            agentReview: { state: 'running', commentsReady: 0 },
            toPost: 0
          }
        ],
        refreshedAt: NOW
      } satisfies ReviewRequestsSnapshot,
      'rr.connection': connection()
    },
    persisted: { plugin: { 'rr.tab': 'in' } }
  },
  /** In review (#57): new commits on the merge request, so "Merge request updated" and Update workspace. */
  inReviewMergeRequestUpdated: {
    requests: {
      'rr.snapshot': {
        reviewRequests: [
          {
            ...card(12, 'Add login with SSO', 5),
            workspace: WORKSPACE,
            startBlocked: null,
            agentReview: { state: 'done', commentsReady: 2 },
            toPost: 2,
            mergeRequestUpdated: true
          },
          {
            ...card(14, 'Fix flaky upload test', 1),
            workspace: { ...WORKSPACE, id: 'repo-api::/wt/review-api-14', path: '/wt/review-api-14' },
            startBlocked: null,
            mergeRequestUpdated: false
          }
        ],
        refreshedAt: NOW
      } satisfies ReviewRequestsSnapshot,
      'rr.connection': connection()
    },
    persisted: { plugin: { 'rr.tab': 'in' } }
  },
  /** Start review disabled, with the hint why (#27). */
  startBlocked: { requests: { 'rr.snapshot': startBlocked } },
  /** The person left the panel on Ended, with nothing there. */
  endedTab: { requests: { 'rr.snapshot': toReview }, persisted: { plugin: { 'rr.tab': 'ended' } } },
  /** Ended cards with Remove workspace, one with why auto-removal skipped it (#28). */
  ended: { requests: { 'rr.snapshot': ended }, persisted: { plugin: { 'rr.tab': 'ended' } } },
  /** The orca CLI is broken: the banner above the tabs, Remove workspace disabled (#15, #28). */
  workspacesUnavailable: {
    requests: {
      'rr.snapshot': { ...ended, workspacesUnavailable: 'The orca CLI failed (exit 1): Orca is not running' }
    },
    persisted: { plugin: { 'rr.tab': 'ended' } }
  },
  /** Filters hide some Review Requests and ignore an invalid entry (#26): footer and warning. */
  filtered: {
    requests: {
      'rr.snapshot': { ...toReview, hiddenByFilters: 3, invalidFilterEntries: ['acme//api'] }
    }
  },
  /** The Review Draft drill-in (#29) with notes, findings, a posted comment and import warnings. */
  reviewDraft: { requests: { 'rr.snapshot': inReview, 'rr.draft': reviewDraft }, persisted: draftOpen },
  /** A Review Draft with nothing imported: no workspace to read, both sections empty. */
  reviewDraftEmpty: {
    requests: {
      'rr.snapshot': inReview,
      'rr.draft': {
        ...reviewDraft,
        workspace: null,
        comments: [],
        warnings: ['This Review Request has no Review Workspace, so there is nothing to import.'],
        importedAt: null
      }
    },
    persisted: draftOpen
  },
  /**
   * After Update workspace moved the workspace to the merge request's new head (#58): the note
   * range's lines changed (may be outdated), the posted note is left alone, and the Agent Findings
   * are stale, one of them on changed lines too.
   */
  reviewDraftMovedOn: {
    requests: {
      'rr.snapshot': inReview,
      'rr.draft': {
        ...reviewDraft,
        comments: reviewDraft.comments.map((c) => ({
          ...c,
          ...(c.id === 'note:n1' || c.id === 'finding:0f3a9c21' ? { outdated: true } : {}),
          ...(c.origin === 'agent-finding' ? { stale: true } : {})
        })),
        warnings: []
      }
    },
    persisted: draftOpen
  },
  /** The worker couldn't answer the Review Draft. */
  reviewDraftFailed: {
    requests: {
      'rr.snapshot': inReview,
      'rr.draft': () => {
        throw hostError('unavailable', 'The worker is not running.')
      }
    },
    persisted: draftOpen
  },
  /** Posting (#30): the confirm step with a summary, an outcome, leftover drafts and a warning. */
  postConfirm: {
    requests: { 'rr.snapshot': inReview, 'rr.draft': reviewDraft, 'rr.connection': connection() },
    persisted: postStep(
      { kind: 'confirm', preview: postPreview, postingSince: null },
      { 'rr.postSummary': 'Nearly there: two things to fix.', 'rr.postOutcome': 'requested_changes' }
    )
  },
  /** The worker is posting: the confirm step locked with a spinner. */
  posting: {
    requests: { 'rr.snapshot': inReview, 'rr.draft': reviewDraft, 'rr.connection': connection() },
    persisted: postStep({ kind: 'confirm', preview: postPreview, postingSince: Date.now() })
  },
  /** Posted: the success callout, the Orca clean-up hint, Posted badges. */
  postSuccess: {
    requests: { 'rr.snapshot': inReview, 'rr.draft': postedDraft(null), 'rr.connection': connection() },
    persisted: postStep({ kind: 'done', result: { posted: 2, failed: [], approveError: null } })
  },
  /** Partly failed: what didn't post (Retry, Delete failed drafts), and an approval refused. */
  postPartialFailure: {
    requests: { 'rr.snapshot': inReview, 'rr.draft': postedDraft('finding:77d0e412'), 'rr.connection': connection() },
    persisted: postStep({
      kind: 'done',
      result: {
        posted: 1,
        failed: [
          { commentId: 'finding:77d0e412', location: 'General comment', message: 'GitLab kept it as a draft: it did not publish.' }
        ],
        approveError: 'SHA does not match HEAD of source branch'
      }
    })
  },
  /** The token lacks the api scope: Post disabled with the hint. */
  postScopeMissing: {
    requests: {
      'rr.snapshot': inReview,
      'rr.draft': reviewDraft,
      'rr.connection': connection({ source: 'token', scopes: ['read_api'], canPost: false })
    },
    persisted: draftOpen
  }
  // A refused post (the api-scope hint from a 403) needs a press, so it's covered by
  // review-post-panel.test.tsx. `events` only delivers Orca events, not worker posts, so rr.changed is covered by
  // panel.test.tsx instead.
})
