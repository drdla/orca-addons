// `orca plugin check` renders the panel once per scenario, each with the REAL worker on a fresh
// host (it activates once per scenario, so it must not call out until configured). Stub the
// panel's requests here so each state is deterministic; add a scenario per panel state.
import { defineCheck, hostError } from 'orca/testing'

export default defineCheck({
  /** No stub: the real, unconfigured worker answers. */
  fresh: {},
  empty: { requests: { 'rr.snapshot': { reviewRequests: [] } } },
  workerDown: {
    requests: {
      'rr.snapshot': () => {
        throw hostError('unavailable', 'The worker is not running.')
      }
    }
  }
})
