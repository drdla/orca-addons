// What every Review Workspace feature reaches Orca and the machine through (#27, #28): the orca
// CLI, git, the host API, the clock, the worker's workspace list and its log. The worker builds
// one and hands it to each feature.
import type { OrcaWorkerApi } from 'orca/worker'
import type { Clock } from '../seams/clock'
import type { Git } from '../seams/git'
import type { OrcaCli } from '../seams/orca-cli'
import type { WorkspaceTracker } from './workspace-tracker'

export type WorkspaceContext = {
  cli: () => OrcaCli
  git: Git
  host: OrcaWorkerApi['host']
  clock: Clock
  workspaces: WorkspaceTracker
  log: (message: string) => void
}
