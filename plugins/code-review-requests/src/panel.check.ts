// `orca plugin check` renders the panel once per scenario, each with the REAL worker on a fresh
// host (it activates once per scenario, so it must not call out until configured). Stub the
// panel's requests here so each state is deterministic; add a scenario per panel state.
// Never seed `settings.instanceUrl` in a scenario: the worker treats it as "configured" and the
// real worker would then poll GitLab through the real glab (src/worker.ts).
import { defineCheck, hostError } from 'orca/testing'
import type { ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'

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

export default defineCheck({
  /** No stub: the real, unconfigured worker answers. */
  fresh: {},
  empty: { requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: null } } },
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
  endedTab: { requests: { 'rr.snapshot': toReview }, persisted: { plugin: { 'rr.tab': 'ended' } } }
  // `events` only delivers Orca events, not worker posts, so rr.changed is covered by
  // panel.test.tsx instead.
})
