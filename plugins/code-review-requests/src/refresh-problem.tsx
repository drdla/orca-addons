// The panel's transient-failure line (#15, #24): "Couldn't refresh · last updated 14m ago ·
// retrying in 1m" with Retry, shown above the last good list. Retry is disabled while GitLab
// rate-limits us. Self-contained so the panel header (#22) can place it where it fits.
import { Button, Callout, Row, Stack, Text } from 'orca'
import { MinuteTime } from './minute-time'
import type { GitLabProblemView } from './protocol'
import { ErrorDetails } from './setup-checklist'

export type RetryingView = Extract<GitLabProblemView, { status: 'retrying' }>

export function RefreshProblem(props: { problem: RetryingView; retrying: boolean; onRetry: () => void }) {
  const { problem } = props
  const limited = problem.rateLimitedUntil
  return (
    <Callout tone="warning" icon="warning" title={problem.offline ? "Can't reach GitLab" : "Couldn't refresh"}>
      <Stack gap="xs">
        <Row justify="between" wrap>
          <Text muted size="xs">
            {problem.offline ? "Couldn't refresh" : 'Showing the last list'}
            {problem.lastSuccessAt === null ? null : ' · last updated '}
            {problem.lastSuccessAt === null ? null : <MinuteTime at={problem.lastSuccessAt} />}
            {problem.retryAt === null || limited !== null ? null : ' · retrying '}
            {problem.retryAt === null || limited !== null ? null : <MinuteTime at={problem.retryAt} />}
          </Text>
          <Button size="xs" icon="refresh" disabled={limited !== null || props.retrying} onPress={props.onRetry}>
            {limited !== null ? `Rate-limited until ${limited}` : props.retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </Row>
        <ErrorDetails message={problem.message} />
      </Stack>
    </Callout>
  )
}
