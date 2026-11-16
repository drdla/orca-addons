// What the worker needs from outside Orca, injected so tests can swap in fakes
// (src/fakes/index.ts → fakeDeps()). Build the real ones lazily: `orca plugin check` imports
// and activates the real worker, so nothing here may spawn or reach the network on load.
import { systemClock, type Clock } from './seams/clock'
import { GitLabError, type GitLabConnection, type GitLabTransport } from './seams/gitlab'
import { OrcaCliError, type OrcaCli } from './seams/orca-cli'

export type Deps = {
  /** Builds the transport for a connection: token mode if it has a token, glab otherwise (#8). */
  gitLab(connection: GitLabConnection): GitLabTransport
  orcaCli(): OrcaCli
  clock: Clock
}

export function realDeps(): Deps {
  return {
    gitLab: () => notYetBuiltTransport,
    orcaCli: () => notYetBuiltCli,
    clock: systemClock
  }
}

// Placeholders until the real adapters land: the glab transport (#20), the token transport
// (#25) and the CLI adapter (#27). They only reject, so nothing calls out by accident.
const notYetBuiltTransport: GitLabTransport = {
  graphql: () => Promise.reject(new GitLabError('needs-you', 'GitLab transport not built yet')),
  rest: () => Promise.reject(new GitLabError('needs-you', 'GitLab transport not built yet'))
}

const notYetBuiltCli: OrcaCli = {
  listWorktrees: () => Promise.reject(cliMissing()),
  showWorktree: () => Promise.reject(cliMissing()),
  createWorktree: () => Promise.reject(cliMissing()),
  removeWorktree: () => Promise.reject(cliMissing())
}

function cliMissing(): OrcaCliError {
  return new OrcaCliError('unavailable', 'orca CLI adapter not built yet')
}
