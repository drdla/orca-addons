// `orca plugin check` renders the panel once per scenario, each with the REAL worker on a fresh
// host (it activates once per scenario, so it must not call out until configured). Stub the
// panel's requests here so each state is deterministic; add a scenario per panel state.
// Never seed `settings.instanceUrl` in a scenario: the worker treats it as "configured" and the
// real worker would then poll GitLab through the real glab (src/worker.ts).
import { defineCheck, hostError } from 'orca/testing'
import type { ConnectionView, ReviewDraftView, ReviewRequestCard, ReviewRequestsSnapshot, SetupReason } from './protocol'

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

const withOverdue: ReviewRequestsSnapshot = {
  reviewRequests: [card(9, 'Migrate billing to the new API', 72, true), ...toReview.reviewRequests],
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

export default defineCheck({
  /** No stub: the real, unconfigured worker answers. */
  fresh: {},
  empty: { requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: null } } },
  // Failure states (#24): the setup checklist per Needs-you reason, and the transient line.
  setupLoggedOut: { requests: { 'rr.snapshot': needsYou('logged-out') } },
  setupGlabMissing: { requests: { 'rr.snapshot': needsYou('glab-missing') } },
  setupTokenRejected: {
    requests: {
      'rr.snapshot': needsYou('token-rejected'),
      'rr.connection': connection({ source: 'token', user: null, canList: false, problem: 'gitlab.example.com: 401 Unauthorized' })
    }
  },
  setupTooOld: { requests: { 'rr.snapshot': needsYou('gitlab-too-old', '17.2.0') } },
  setupBadUrl: { requests: { 'rr.snapshot': needsYou('bad-url') } },
  retrying: { requests: { 'rr.snapshot': retrying(null, false) } },
  offline: { requests: { 'rr.snapshot': retrying(null, true) } },
  rateLimited: { requests: { 'rr.snapshot': retrying('09:10', false) } },
  // The Connection section (#25): collapsed while healthy, open while GitLab fails.
  connectionHealthy: { requests: { 'rr.snapshot': toReview, 'rr.connection': connection() } },
  connectionTokenReadOnly: {
    requests: {
      'rr.snapshot': retrying(null, false),
      'rr.connection': connection({ source: 'token', scopes: ['read_api'], canList: true, canPost: false })
    }
  },
  connectionProblem: {
    requests: {
      'rr.snapshot': retrying(null, true),
      'rr.connection': connection({ user: null, canList: null, problem: 'No response from gitlab.example.com: fetch failed' })
    }
  },
  connectionNoKeyStore: {
    requests: { 'rr.snapshot': retrying(null, false), 'rr.connection': connection({ tokenStorage: 'unavailable' }) }
  },
  workerDown: {
    requests: {
      'rr.snapshot': () => {
        throw hostError('unavailable', 'The worker is not running.')
      }
    }
  },
  /** The To review tab with cards, none overdue. */
  toReview: { requests: { 'rr.snapshot': toReview } },
  /** An overdue card: danger border and badge, warning icon on the tab. */
  overdue: { requests: { 'rr.snapshot': withOverdue } },
  /** The person left the panel on In review, with nothing there. */
  inReviewTab: { requests: { 'rr.snapshot': toReview }, persisted: { plugin: { 'rr.tab': 'in' } } },
  /** In review: a card with a Review Workspace, Open workspace and Run agent review (#27). */
  inReview: { requests: { 'rr.snapshot': inReview }, persisted: { plugin: { 'rr.tab': 'in' } } },
  /** To review next to an In review card: Start review and its Agent Review button (#27). */
  startReview: { requests: { 'rr.snapshot': inReview } },
  /** Start review disabled, with the hint why (#27). */
  startBlocked: { requests: { 'rr.snapshot': startBlocked } },
  /** The person left the panel on Ended (empty until #28). */
  endedTab: { requests: { 'rr.snapshot': toReview }, persisted: { plugin: { 'rr.tab': 'ended' } } },
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
  /** The worker couldn't answer the Review Draft. */
  reviewDraftFailed: {
    requests: {
      'rr.snapshot': inReview,
      'rr.draft': () => {
        throw hostError('unavailable', 'The worker is not running.')
      }
    },
    persisted: draftOpen
  }
  // `events` only delivers Orca events, not worker posts, so rr.changed is covered by
  // panel.test.tsx instead.
})
