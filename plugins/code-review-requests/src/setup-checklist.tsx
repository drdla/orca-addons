// The panel's "Needs you" state (#8, #15, #24): what's missing and how to fix it. Polling has
// stopped; "Check again" asks the worker to retry. Self-contained so the panel renders it in place
// of the list (and the tabs) while GitLab needs setting up. Token entry (Replace/Remove token,
// path ②) is #25's to add here.
import { Button, Callout, Code, Collapsible, Row, Stack, Text } from 'orca'
import type { GitLabProblemView } from './protocol'

export type NeedsYouView = Extract<GitLabProblemView, { status: 'needs-you' }>

export function SetupChecklist(props: { problem: NeedsYouView; checking: boolean; onCheckAgain: () => void }) {
  const { problem } = props
  return (
    <Stack gap="sm">
      <Callout tone="warning" icon="plug" title="Connect GitLab">
        <Stack gap="xs">
          <Text>{headline(problem)}</Text>
          <Steps problem={problem} />
        </Stack>
      </Callout>
      <Row gap="sm">
        <Button icon="refresh" disabled={props.checking} onPress={props.onCheckAgain}>
          {props.checking ? 'Checking…' : 'Check again'}
        </Button>
      </Row>
      <ErrorDetails message={problem.message} />
    </Stack>
  )
}

function headline(problem: NeedsYouView): string {
  const host = problem.host ?? 'GitLab'
  switch (problem.reason) {
    case 'glab-missing':
      return 'glab is not installed, so Review Requests cannot be loaded.'
    case 'logged-out':
      return `glab is not logged in to ${host}.`
    case 'token-rejected':
      return `Token rejected (expired or revoked) by ${host}.`
    case 'gitlab-too-old':
      return `Needs GitLab 17.4+, this instance runs ${problem.version ?? 'an older version'}.`
    case 'bad-url':
      return 'The GitLab instance URL in Settings is not a valid URL.'
  }
}

function Steps(props: { problem: NeedsYouView }) {
  const { problem } = props
  const login = `glab auth login --hostname ${problem.host ?? 'gitlab.com'}`
  switch (problem.reason) {
    case 'glab-missing':
      return (
        <Stack gap="xs">
          <Text>1. Install glab:</Text>
          <Code>brew install glab</Code>
          <Text>2. Log in, then check again:</Text>
          <Code>{login}</Code>
        </Stack>
      )
    case 'logged-out':
      return (
        <Stack gap="xs">
          <Text>Log in in a terminal, then check again:</Text>
          <Code>{login}</Code>
        </Stack>
      )
    case 'token-rejected':
      return <Text>Replace or remove the token, then check again.</Text>
    case 'gitlab-too-old':
      return <Text>Ask your GitLab admin to upgrade, or point the instance URL at another GitLab.</Text>
    case 'bad-url':
      return <Text>Fix "GitLab instance URL" in Settings, for example https://gitlab.com.</Text>
  }
}

/** Every surfaced error has the raw message behind a Details disclosure (#15). */
export function ErrorDetails(props: { message: string }) {
  return (
    <Collapsible title="Details">
      <Code block>{props.message}</Code>
    </Collapsible>
  )
}
