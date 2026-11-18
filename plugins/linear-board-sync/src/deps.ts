// What the worker needs from outside Orca's plugin API, injected so tests swap in fakes. Built
// lazily: `orca plugin check` imports and activates the real worker, so nothing here may spawn on load.
import { createOrcaCli, spawnOrca } from './orca-cli-process'
import { systemClock, type Clock } from './seams/clock'
import type { OrcaCli } from './seams/orca-cli'

export type Deps = { cli: OrcaCli; clock: Clock }

export function realDeps(): Deps {
  return { cli: createOrcaCli(spawnOrca), clock: systemClock }
}
