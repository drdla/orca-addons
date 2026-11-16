// The Review Requests panel. No build step: Orca strips the types and compiles the JSX on load.
// It has no network: every piece of data comes from the worker through plugin.request, and
// every request needs a .catch (an unhandled rejection fails tests and `orca plugin check`).
import {
  atom,
  Callout,
  derived,
  EmptyState,
  Heading,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Stack,
  type PanelContext
} from 'orca'
import type { ReviewRequestsSnapshot } from './protocol'
import { RefreshProblem } from './refresh-problem'
import { SetupChecklist } from './setup-checklist'

/** The worker's last answer; null until it answers. */
const snapshot = atom<ReviewRequestsSnapshot | null>(null)
/** Why the worker could not answer, if it could not. */
const failure = atom<string | null>(null)
/** True while a Retry / Check again (rr.retry) is in flight. */
const retrying = atom(false)
/** GitLab needs setting up: the setup checklist replaces the list (#24). */
const needsSetup = derived(() => read(snapshot)?.gitlab?.status === 'needs-you')

export function setup(_ctx: PanelContext): void {
  plugin
    .request('rr.snapshot')
    .then((answer) => {
      set(snapshot, answer)
      set(failure, null)
    })
    .catch((error: unknown) => {
      set(failure, error instanceof Error ? error.message : String(error))
    })
}

/** Asks the worker to poll now and shows its answer. */
function retry(): void {
  set(retrying, true)
  plugin
    .request('rr.retry')
    .then((answer) => {
      set(snapshot, answer)
      set(failure, null)
    })
    .catch((error: unknown) => {
      set(failure, error instanceof Error ? error.message : String(error))
    })
    .finally(() => set(retrying, false))
}

export default function Panel() {
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading level={2}>Review Requests</Heading>
      </Row>
      <GitLabProblem />
      {read(needsSetup) ? null : <Body />}
    </Stack>
  )
}

function Body() {
  const problem = read(failure)
  if (problem !== null) {
    return (
      <Callout tone="warning" icon="warning" title="Can't load Review Requests">
        {problem}
      </Callout>
    )
  }
  const current = read(snapshot)
  if (current === null) return <Skeleton lines={6} label="Loading Review Requests" />
  return <EmptyState icon="check" title="Nothing to review" />
}

/** Why GitLab can't be polled right now, if it can't (#24). */
function GitLabProblem() {
  const problem = read(snapshot)?.gitlab
  if (problem === undefined) return null
  if (problem.status === 'needs-you') {
    return <SetupChecklist problem={problem} checking={read(retrying)} onCheckAgain={retry} />
  }
  return <RefreshProblem problem={problem} retrying={read(retrying)} onRetry={retry} />
}
