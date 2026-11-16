// What the worker needs from outside Orca, injected so tests can swap in fakes
// (src/fakes/index.ts → fakeDeps()). Build the real ones lazily: `orca plugin check` imports
// and activates the real worker, so nothing here may spawn or reach the network on load.
import { isExecutable, spawnGlab } from './gitlab/glab-process'
import { createGlabTransport, locateGlab } from './gitlab/glab-transport'
import { systemClock, type Clock } from './seams/clock'
import { systemDesktop } from './desktop-process'
import type { Desktop } from './seams/desktop'
import type { Git } from './seams/git'
import { systemGit } from './git-process'
import { GitLabError, type GitLabConnection, type GitLabTransport } from './seams/gitlab'
import type { OrcaCli } from './seams/orca-cli'
import { createOrcaCli, spawnOrca } from './orca-cli-process'

export type Deps = {
  /** Builds the transport for a connection: token mode if it has a token, glab otherwise (#8). */
  gitLab(connection: GitLabConnection): GitLabTransport
  orcaCli(): OrcaCli
  clock: Clock
  /** Clipboard and opening the panel (#22). */
  desktop: Desktop
  /** Fetching an MR head for a Review Workspace (#27). */
  git: Git
}

export function realDeps(): Deps {
  return {
    gitLab: (connection) =>
      connection.token === null
        ? createGlabTransport({
            host: connection.host,
            run: spawnGlab,
            locate: () => locateGlab(process.env, isExecutable)
          })
        : notYetBuiltTransport,
    orcaCli: () => systemOrcaCli,
    clock: systemClock,
    desktop: systemDesktop,
    git: systemGit
  }
}

// Placeholder until the token transport lands (#25). It only rejects, so nothing calls out by accident.
const notYetBuiltTransport: GitLabTransport = {
  graphql: () => Promise.reject(new GitLabError('needs-you', 'GitLab transport not built yet')),
  rest: () => Promise.reject(new GitLabError('needs-you', 'GitLab transport not built yet'))
}

const systemOrcaCli: OrcaCli = createOrcaCli(spawnOrca)
