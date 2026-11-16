// What the worker needs from outside Orca, injected so tests can swap in fakes
// (src/fakes/index.ts → fakeDeps()). Build the real ones lazily: `orca plugin check` imports
// and activates the real worker, so nothing here may spawn or reach the network on load.
import { isExecutable, spawnGlab } from './gitlab/glab-process'
import { createGlabTransport, locateGlab } from './gitlab/glab-transport'
import { createTokenTransport } from './gitlab/token-transport'
import { loggedInHosts } from './gitlab/glab-auth-status'
import type { GlabLogins } from './seams/glab-logins'
import { systemClock, type Clock } from './seams/clock'
import { systemDesktop } from './desktop-process'
import type { Desktop } from './seams/desktop'
import type { Git } from './seams/git'
import type { Files } from './seams/files'
import { systemFiles } from './files-process'
import { systemGit } from './git-process'
import type { GitLabConnection, GitLabTransport } from './seams/gitlab'
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
  /** Reading an Agent Review's findings.json (#29). */
  files: Files
  /** The hosts glab is logged in to, for the setup checklist's "Use <host>" (#8). */
  glab: GlabLogins
}

export function realDeps(): Deps {
  return {
    gitLab: (connection) =>
      connection.token === null
        ? createGlabTransport({
            host: connection.host,
            run: spawnGlab,
            locate: () => locateGlab(process.env, isExecutable, connection.glabPath)
          })
        : createTokenTransport({ host: connection.host, token: connection.token, fetch: globalThis.fetch }),
    orcaCli: () => systemOrcaCli,
    clock: systemClock,
    desktop: systemDesktop,
    git: systemGit,
    files: systemFiles,
    glab: systemGlabLogins
  }
}

const systemGlabLogins: GlabLogins = {
  async loggedInHosts(glabPath) {
    const glab = locateGlab(process.env, isExecutable, glabPath)
    if (glab === null) return []
    // glab writes the status to stderr, and exits 1 when any host's login fails.
    const run = await spawnGlab(glab, ['auth', 'status'], undefined).catch(() => null)
    return run === null ? [] : loggedInHosts(`${run.stdout}\n${run.stderr}`)
  }
}

const systemOrcaCli: OrcaCli = createOrcaCli(spawnOrca)
