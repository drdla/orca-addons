// The panel's Ended tab (#7, #28): one card per Ended Review Request that still has its Review
// Workspace. It offers Open workspace and Delete Workspace (workspace-removal.tsx, shared with a
// review in progress). Also the banner shown while the orca CLI is broken (#15).
import {
  atom,
  Box,
  Callout,
  host,
  IconButton,
  plugin,
  read,
  Row,
  Spinner,
  Stack,
  Text,
  update,
  type BadgeProps
} from 'orca'
import { authorNameOf } from './author'
import { Badge } from './badge'
import { Button } from './button'
import { MergeRequestLink } from './merge-request-link'
import type { EndedCard, EndedReason, ReviewRequestsSnapshot } from './protocol'
import { ErrorDetails } from './setup-checklist'
import { messageOf } from './errors'
import { shortTitle } from './short-title'
import { isRemoving, RemovalError, removeWorkspace } from './workspace-removal'

/** Per-card errors of Open workspace and the GitLab link. */
const errors = atom<Record<string, { message: string; detail?: string }>>({})

const REASONS: Record<EndedReason, string> = {
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  merged: 'Merged',
  closed: 'Closed',
  unassigned: 'Removed as reviewer'
}

function patch<T>(store: typeof errors, url: string, value: T | null): void {
  update(store as never, (all: Record<string, T>) => {
    const next = { ...all }
    if (value === null) delete next[url]
    else next[url] = value
    return next
  })
}

function openWorkspace(url: string): void {
  plugin
    .request('rr.openWorkspace', { url })
    .catch((error: unknown) =>
      patch(errors, url, { message: `Couldn't open the workspace: ${messageOf(error)}` })
    )
}

function openInGitLab(url: string): void {
  host
    .call('shell.openExternal', { url })
    .catch((error: unknown) =>
      patch(errors, url, { message: `Couldn't open the link: ${messageOf(error)}` })
    )
}

/** Shown above the tabs while the orca CLI can't list workspaces: their actions are off. */
export function WorkspacesUnavailable(props: { reason: string }) {
  return (
    <Callout tone="warning" icon="warning" title="Orca CLI unavailable: workspace actions disabled">
      <Stack gap="xs">
        <Text muted size="xs">
          Review Requests still refresh. Workspace actions come back once the orca CLI answers again.
        </Text>
        <ErrorDetails message={props.reason} />
      </Stack>
    </Callout>
  )
}

export function EndedList(props: {
  cards: EndedCard[]
  disabled: boolean
  received: (snapshot: ReviewRequestsSnapshot) => void
}) {
  return (
    <Stack gap="sm">
      {props.cards.map((c) => (
        <EndedCardView key={c.url} card={c} disabled={props.disabled} received={props.received} />
      ))}
    </Stack>
  )
}

function EndedCardView(props: {
  card: EndedCard
  disabled: boolean
  received: (snapshot: ReviewRequestsSnapshot) => void
}) {
  const { card } = props
  const working = isRemoving(card.url)
  const error = read(errors)[card.url]
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row gap="sm" align="start">
        <MergeRequestLink url={card.url} iid={card.iid} onOpen={openInGitLab} />
        {/* Nudged down 2px so the title's first line sits level with the button's text; the
            author sits under the title, at its indent, as on the other cards. */}
        <Box direction="column">
          <Box height={2} />
          <Text weight="semibold">{shortTitle(card.title)}</Text>
          <Text muted size="xs">{`by ${authorNameOf(card)}`}</Text>
        </Box>
      </Row>
      {/* Like a Reviewing card: the way into the workspace on its own row, above the action. */}
      <Row gap="xs" align="center">
        <IconButton
          icon="folder"
          label="Open workspace"
          variant="ghost"
          size="xs"
          disabled={props.disabled || working}
          onPress={() => openWorkspace(card.url)}
        />
        {/* Why it ended, after the workspace button: in the header it squeezed the title. */}
        <ReasonPill reason={card.reason} />
      </Row>
      <Row gap="xs" align="center" wrap>
        <Button
          size="xs"
          icon="delete"
          disabled={props.disabled || working}
          tooltip="Delete workspace"
          onPress={() => removeWorkspace(card.url, props.received)}
        >
          Delete Workspace
        </Button>
        {working && <Spinner label="Working" labelHidden />}
      </Row>
      {card.autoRemoveSkipped !== null && (
        <Text muted size="xs">
          {card.autoRemoveSkipped}
        </Text>
      )}
      <RemovalError url={card.url} />
      {error !== undefined && (
        <Text tone="danger" size="xs">
          {error.message}
        </Text>
      )}
    </Box>
  )
}

/** Why the review ended, in a neutral Badge: a toned one would draw a status dot. */
/**
 * Each reason's status dot: the user's own outcome as everywhere (approved success, changes
 * requested warning); merged success; closed and removed as reviewer neutral, without a dot.
 */
const REASON_TONES: Record<EndedReason, BadgeTone> = {
  approved: 'success',
  'changes-requested': 'warning',
  merged: 'success',
  closed: 'neutral',
  unassigned: 'neutral'
}

/** Why it ended, with a status dot; the Badge wrapper spaces the label from the dot. */
function ReasonPill({ reason }: { reason: EndedReason }) {
  return <Badge tone={REASON_TONES[reason] ?? 'neutral'}>{REASONS[reason] ?? 'Ended'}</Badge>
}

type BadgeTone = NonNullable<BadgeProps['tone']>
