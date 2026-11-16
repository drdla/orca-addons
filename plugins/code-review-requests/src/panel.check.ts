// `orca plugin check` renders the panel once per scenario, each with the REAL worker on a fresh
// host (it activates once per scenario, so it must not call out until configured). Stub the
// panel's requests here so each state is deterministic; add a scenario per panel state.
// Never seed `settings.instanceUrl` in a scenario: the worker treats it as "configured" and the
// real worker would then poll GitLab through the real glab (src/worker.ts).
import { defineCheck, hostError } from 'orca/testing'
import type { ConnectionView, ReviewRequestCard, ReviewRequestsSnapshot, SetupReason } from './protocol'

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
  }
  // `events` only delivers Orca events, not worker posts, so rr.changed is covered by
  // panel.test.tsx instead.
})
