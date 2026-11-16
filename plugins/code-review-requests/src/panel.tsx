// The Review Requests panel. No build step: Orca strips the types and compiles the JSX on load.
// It has no network: every piece of data comes from the worker through plugin.request, and
// every request needs a .catch (an unhandled rejection fails tests and `orca plugin check`).
import {
  atom,
  Callout,
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

/** The worker's last answer; null until it answers. */
const snapshot = atom<ReviewRequestsSnapshot | null>(null)
/** Why the worker could not answer, if it could not. */
const failure = atom<string | null>(null)

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

export default function Panel() {
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading level={2}>Review Requests</Heading>
      </Row>
      <Body />
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
