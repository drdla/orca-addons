// `orca plugin check` renders the panel once per scenario, each with the REAL worker on a fresh
// host (it activates once per scenario, so it must not call out until configured). Stub the
// panel's requests here so each state is deterministic; add a scenario per panel state.
// Never seed `settings.instanceUrl` in a scenario: the worker treats it as "configured" and the
// real worker would then poll GitLab through the real glab (src/worker.ts).
import { defineCheck, hostError } from 'orca/testing'
import type { ReviewRequestsSnapshot, SetupReason } from './protocol'

const AT = Date.UTC(2026, 10, 16, 9, 0, 0)

function needsYou(reason: SetupReason, version: string | null = null): ReviewRequestsSnapshot {
  return {
    reviewRequests: [],
    gitlab: {
      status: 'needs-you',
      reason,
      host: reason === 'bad-url' ? null : 'gitlab.example.com',
      version,
      message: `gitlab.example.com: ${reason}`
    }
  }
}

function retrying(rateLimitedUntil: string | null, offline: boolean): ReviewRequestsSnapshot {
  return {
    reviewRequests: [],
    gitlab: {
      status: 'retrying',
      message: 'gitlab.example.com: 503 Service Unavailable',
      lastSuccessAt: AT - 14 * 60_000,
      retryAt: AT + 60_000,
      rateLimitedUntil,
      offline
    }
  }
}

export default defineCheck({
  /** No stub: the real, unconfigured worker answers. */
  fresh: {},
  empty: { requests: { 'rr.snapshot': { reviewRequests: [] } } },
  // Failure states (#24): the setup checklist per Needs-you reason, and the transient line.
  setupLoggedOut: { requests: { 'rr.snapshot': needsYou('logged-out') } },
  setupGlabMissing: { requests: { 'rr.snapshot': needsYou('glab-missing') } },
  setupTokenRejected: { requests: { 'rr.snapshot': needsYou('token-rejected') } },
  setupTooOld: { requests: { 'rr.snapshot': needsYou('gitlab-too-old', '17.2.0') } },
  setupBadUrl: { requests: { 'rr.snapshot': needsYou('bad-url') } },
  retrying: { requests: { 'rr.snapshot': retrying(null, false) } },
  offline: { requests: { 'rr.snapshot': retrying(null, true) } },
  rateLimited: { requests: { 'rr.snapshot': retrying('09:10', false) } },
  workerDown: {
    requests: {
      'rr.snapshot': () => {
        throw hostError('unavailable', 'The worker is not running.')
      }
    }
  }
})
