// Test doubles for every outside seam, wired into a Deps the worker accepts:
//   const fakes = fakeDeps()
//   const worker = await mountWorker(createWorker(fakes.deps), { host })
//   fakes.gitlab.addMergeRequest(...); await fakes.clock.advance(5 * 60_000)
import type { Deps } from '../deps'
import type { GitLabConnection } from '../seams/gitlab'
import { FakeClock } from './fake-clock'
import { FakeGitLab, type FakeGitLabOptions } from './fake-gitlab'
import { FakeOrcaCli } from './fake-orca-cli'
import { FakeDesktop } from './fake-desktop'
import { FakeGit } from './fake-git'
import { FakeFiles } from './fake-files'
import { FakeGlab } from './fake-glab'

export { FakeClock } from './fake-clock'
export { FakeGlab } from './fake-glab'
export { FakeGitLab } from './fake-gitlab'
export { FakeOrcaCli } from './fake-orca-cli'
export { FakeDesktop } from './fake-desktop'
export { FakeGit } from './fake-git'
export { FakeFiles } from './fake-files'

export type Fakes = {
  deps: Deps
  gitlab: FakeGitLab
  cli: FakeOrcaCli
  clock: FakeClock
  desktop: FakeDesktop
  git: FakeGit
  files: FakeFiles
  glab: FakeGlab
  /** Every connection the worker built a transport for, in order. */
  connections: GitLabConnection[]
}

export function fakeDeps(options: { start?: number; gitlab?: FakeGitLabOptions } = {}): Fakes {
  const clock = new FakeClock(options.start)
  const gitlab = new FakeGitLab({ clock, ...options.gitlab })
  const cli = new FakeOrcaCli()
  const connections: GitLabConnection[] = []
  const desktop = new FakeDesktop()
  const git = new FakeGit()
  const files = new FakeFiles()
  const glab = new FakeGlab()
  const deps: Deps = {
    gitLab: (connection) => {
      connections.push(connection)
      return connection.token === null ? gitlab : gitlab.withToken(connection.token)
    },
    orcaCli: () => cli,
    clock,
    desktop,
    git,
    files,
    glab
  }
  return { deps, gitlab, cli, clock, desktop, git, files, glab, connections }
}
