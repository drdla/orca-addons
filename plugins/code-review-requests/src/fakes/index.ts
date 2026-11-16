// Test doubles for every outside seam, wired into a Deps the worker accepts:
//   const fakes = fakeDeps()
//   const worker = await mountWorker(createWorker(fakes.deps), { host })
//   fakes.gitlab.addMergeRequest(...); await fakes.clock.advance(5 * 60_000)
import type { Deps } from '../deps'
import type { GitLabConnection } from '../seams/gitlab'
import { FakeClock } from './fake-clock'
import { FakeGitLab, type FakeGitLabOptions } from './fake-gitlab'
import { FakeOrcaCli } from './fake-orca-cli'

export { FakeClock } from './fake-clock'
export { FakeGitLab } from './fake-gitlab'
export { FakeOrcaCli } from './fake-orca-cli'

export type Fakes = {
  deps: Deps
  gitlab: FakeGitLab
  cli: FakeOrcaCli
  clock: FakeClock
  /** Every connection the worker built a transport for, in order. */
  connections: GitLabConnection[]
}

export function fakeDeps(options: { start?: number; gitlab?: FakeGitLabOptions } = {}): Fakes {
  const clock = new FakeClock(options.start)
  const gitlab = new FakeGitLab({ clock, ...options.gitlab })
  const cli = new FakeOrcaCli()
  const connections: GitLabConnection[] = []
  const deps: Deps = {
    gitLab: (connection) => {
      connections.push(connection)
      return gitlab
    },
    orcaCli: () => cli,
    clock
  }
  return { deps, gitlab, cli, clock, connections }
}
