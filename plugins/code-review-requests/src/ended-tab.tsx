// The panel's Ended tab (#7, #28): one card per Ended Review Request that still has its Review
// Workspace. Its actions are Review draft (post what is left, #30) and Remove workspace: the worker checks what removal would lose, the
// card asks to confirm (Remove, or Remove anyway when it would force), and on failure shows
// Orca's error with Open workspace. Also the banner shown while the orca CLI is broken (#15).
import {
  atom,
  Badge,
  Box,
  Callout,
  host,
  plugin,
  read,
  Row,
  Spinner,
  Stack,
  Text,
  update,
} from 'orca'
import { Button } from './button'
import { MergeRequestLink } from './merge-request-link'
import type { EndedCard, EndedReason, RemovalCheck, ReviewRequestsSnapshot } from './protocol'
import { openReviewDraft } from './review-draft-view'
import { ErrorDetails } from './setup-checklist'
import { messageOf } from './errors'
import { MinuteTime } from './minute-time'

/** Open confirmations, by Review Request URL: what removal would lose. */
const confirming = atom<Record<string, RemovalCheck>>({})
/** Cards with a check or removal under way. */
const busy = atom<Record<string, true>>({})
/** Per-card errors; `removal` ones offer Open workspace. */
const errors = atom<Record<string, { message: string; detail?: string; removal: boolean }>>({})

const REASONS: Record<EndedReason, string> = {
  approved: 'Approved',
  merged: 'Merged',
  closed: 'Closed',
  unassigned: 'Removed as reviewer'
}

function patch<T>(store: typeof confirming | typeof busy | typeof errors, url: string, value: T | null): void {
  update(store as never, (all: Record<string, T>) => {
    const next = { ...all }
    if (value === null) delete next[url]
    else next[url] = value
    return next
  })
}

/** Removing a workspace waits for Orca's own checks; 120 s is a panel request's maximum. */
const REMOVE_TIMEOUT_MS = 120_000

function askToRemove(url: string): void {
  patch(busy, url, true)
  patch(errors, url, null)
  plugin
    .request('rr.checkRemoval', { url }, { timeoutMs: 60_000 })
    .then((check) => patch(confirming, url, check))
    .catch((error: unknown) =>
      patch(errors, url, { message: "Couldn't check the workspace", detail: messageOf(error), removal: false })
    )
    .finally(() => patch(busy, url, null))
}

function remove(url: string, force: boolean, received: (snapshot: ReviewRequestsSnapshot) => void): void {
  patch(confirming, url, null)
  patch(busy, url, true)
  plugin
    .request('rr.removeWorkspace', { url, force }, { timeoutMs: REMOVE_TIMEOUT_MS })
    .then(received)
    .catch((error: unknown) =>
      patch(errors, url, { message: `Couldn't remove the workspace: ${messageOf(error)}`, removal: true })
    )
    .finally(() => patch(busy, url, null))
}

function openWorkspace(url: string): void {
  plugin
    .request('rr.openWorkspace', { url })
    .catch((error: unknown) =>
      patch(errors, url, { message: `Couldn't open the workspace: ${messageOf(error)}`, removal: true })
    )
}

function openInGitLab(url: string): void {
  host
    .call('shell.openExternal', { url })
    .catch((error: unknown) =>
      patch(errors, url, { message: `Couldn't open the link: ${messageOf(error)}`, removal: false })
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
  const working = read(busy)[card.url] === true
  const check = read(confirming)[card.url]
  const error = read(errors)[card.url]
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="start">
        <Row gap="sm" align="start">
          <MergeRequestLink url={card.url} iid={card.iid} onOpen={openInGitLab} />
          {/* Nudged down 2px so the title's first line sits level with the button's text. */}
          <Box direction="column">
            <Box height={2} />
            <Text weight="semibold">{card.title}</Text>
          </Box>
        </Row>
        <Badge tone={card.reason === 'merged' || card.reason === 'approved' ? 'success' : 'neutral'}>
          {REASONS[card.reason] ?? 'Ended'}
        </Badge>
      </Row>
      <Text muted size="xs">
        {`${card.author} · ended `}
        <MinuteTime at={card.endedAt} />
        {` · ${card.workspace.name}`}
      </Text>
      {check === undefined && (
        <Row gap="xs">
          <Button
            size="xs"
            icon="delete"
            disabled={props.disabled || working}
            tooltip="Remove this Review Workspace from Orca"
            onPress={() => askToRemove(card.url)}
          >
            Remove workspace
          </Button>
          <Button size="xs" variant="outline" icon="edit" onPress={() => openReviewDraft(card.url)}>
            Review draft
          </Button>
          {working && <Spinner label="Working" labelHidden />}
        </Row>
      )}
      {check !== undefined && (
        <Confirmation card={card} check={check} disabled={props.disabled} received={props.received} />
      )}
      {card.autoRemoveSkipped !== null && (
        <Text muted size="xs">
          {card.autoRemoveSkipped}
        </Text>
      )}
      {error !== undefined && (
        <Stack gap="xs">
          <Text tone="danger" size="xs">
            {error.message}
          </Text>
          {error.detail !== undefined && <ErrorDetails message={error.detail} />}
          {error.removal && (
            <Row>
              <Button size="xs" icon="folder" disabled={props.disabled} onPress={() => openWorkspace(card.url)}>
                Open workspace
              </Button>
            </Row>
          )}
        </Stack>
      )}
    </Box>
  )
}

function Confirmation(props: {
  card: EndedCard
  check: RemovalCheck
  disabled: boolean
  received: (snapshot: ReviewRequestsSnapshot) => void
}) {
  const { card, check } = props
  const clean = check.problems.length === 0
  return (
    <Callout
      tone={clean ? 'neutral' : 'warning'}
      icon={clean ? 'delete' : 'warning'}
      title={`Remove ${card.workspace.name}?`}
    >
      <Stack gap="xs">
        <Text size="xs">
          {clean
            ? 'Orca removes the workspace and deletes its branch if it was merged.'
            : `This would lose: ${check.problems.join(', ')}. Removing stops its terminals and agents.`}
        </Text>
        <Row gap="xs">
          <Button
            size="xs"
            tone="danger"
            disabled={props.disabled}
            onPress={() => remove(card.url, check.force, props.received)}
          >
            {clean ? 'Remove' : 'Remove anyway'}
          </Button>
          <Button size="xs" variant="ghost" onPress={() => patch(confirming, card.url, null)}>
            Cancel
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}
