// The panel's "Needs you" state (#8, #15, #24): what's missing and how to fix it. Polling has
// stopped; "Check again" asks the worker to retry. Self-contained so the panel renders it in place
// of the list (and the tabs) while GitLab needs setting up. While glab is the problem, a token
// is the second path; a rejected token can be replaced or removed here (#25).
import { atom, Button, Callout, Code, Collapsible, IconButton, plugin, read, Row, set, Stack, Text } from 'orca'
import { TokenEntry } from './connection-section'
import { messageOf } from './errors'
import type { GitLabProblemView, ReviewRequestsSnapshot } from './protocol'

/** Why Copy or "Use <host>" didn't work, if it didn't. */
const actionError = atom<string | null>(null)

export type NeedsYouView = Extract<GitLabProblemView, { status: 'needs-you' }>

export function SetupChecklist(props: {
  problem: NeedsYouView
  checking: boolean
  onCheckAgain: () => void
  /** The worker's answer to "Use <host>". */
  onSnapshot: (snapshot: ReviewRequestsSnapshot) => void
}) {
  const { problem } = props
  const error = read(actionError)
  return (
    <Stack gap="sm">
      <Callout tone="warning" icon="plug" title="Connect GitLab">
        <Stack gap="xs">
          <Text>{headline(problem)}</Text>
          <Steps problem={problem} />
          <OtherHosts problem={problem} onSnapshot={props.onSnapshot} />
        </Stack>
      </Callout>
      {error !== null && (
        <Text tone="danger" size="xs">
          {error}
        </Text>
      )}
      {hasTokenPath(problem) && <TokenEntry host={problem.host} />}
      <Row gap="sm">
        <Button icon="refresh" disabled={props.checking} onPress={props.onCheckAgain}>
          {props.checking ? 'Checking…' : 'Check again'}
        </Button>
      </Row>
      <ErrorDetails message={problem.message} />
    </Stack>
  )
}

/** glab missing or logged out: a token is path ②. A rejected token: replace or remove it. */
function hasTokenPath(problem: NeedsYouView): boolean {
  return problem.reason === 'glab-missing' || problem.reason === 'logged-out' || problem.reason === 'token-rejected'
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

function copy(text: string): void {
  set(actionError, null)
  plugin
    .request('rr.copyText', { text })
    .catch((error: unknown) => set(actionError, `Couldn't copy the command: ${messageOf(error)}`))
}

function useHost(host: string, onSnapshot: (snapshot: ReviewRequestsSnapshot) => void): void {
  set(actionError, null)
  plugin
    .request('rr.useHost', { host }, { timeoutMs: 120_000 })
    .then(onSnapshot)
    .catch((error: unknown) => set(actionError, `Couldn't switch to ${host}: ${messageOf(error)}`))
}

/** The glab login command, with a Copy button (panels have no clipboard; the worker copies). */
function LoginCommand(props: { command: string }) {
  return (
    <Row gap="xs" align="center">
      <Code>{props.command}</Code>
      <IconButton
        icon="copy"
        label="Copy the glab login command"
        variant="ghost"
        size="xs"
        onPress={() => copy(props.command)}
      />
    </Row>
  )
}

/** glab is logged in to other hosts: one click points the instance URL at one of them (#8). */
function OtherHosts(props: { problem: NeedsYouView; onSnapshot: (snapshot: ReviewRequestsSnapshot) => void }) {
  const hosts = props.problem.reason === 'logged-out' ? (props.problem.glabHosts ?? []) : []
  if (hosts.length === 0) return null
  return (
    <Stack gap="xs">
      <Text>glab is logged in to another GitLab. Use it instead:</Text>
      <Row gap="xs" wrap>
        {hosts.map((host) => (
          <Button key={host} size="sm" variant="outline" icon="globe" onPress={() => useHost(host, props.onSnapshot)}>
            {`Use ${host}`}
          </Button>
        ))}
      </Row>
    </Stack>
  )
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
          <LoginCommand command={login} />
          <Text>Or paste a personal access token below.</Text>
        </Stack>
      )
    case 'logged-out':
      return (
        <Stack gap="xs">
          <Text>Log in in a terminal, then check again:</Text>
          <LoginCommand command={login} />
          <Text>Or paste a personal access token below.</Text>
        </Stack>
      )
    case 'token-rejected':
      return <Text>Replace the token below, or remove it to use glab.</Text>
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
