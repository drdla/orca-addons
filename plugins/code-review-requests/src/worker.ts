// The plugin's worker. Orca transpiles this file on load; a save, update or crash restarts it and
// drops its memory, so anything that must last goes in orca.storage.
//
// activate() must stay side-effect-free until GitLab is configured: `orca plugin check` runs the
// real worker once per scenario, with the CLI's full environment, so starting a poll, spawning
// glab or the orca CLI here would call out for real.
import type { OrcaWorkerApi } from 'orca/worker'
import { realDeps, type Deps } from './deps'
import type { ReviewRequestsSnapshot } from './protocol'

const EMPTY: ReviewRequestsSnapshot = { reviewRequests: [] }

/** Builds activate() over the given seams; tests pass fakeDeps().deps. */
export function createActivate(_deps: Deps) {
  return function activate(orca: OrcaWorkerApi): void {
    orca.panels.handle('rr.snapshot', async () => EMPTY)
  }
}

export default createActivate(realDeps())
