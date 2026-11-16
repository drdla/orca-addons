// The Review Requests panel (#10 variant D): a header, then tabs To review / In review / Ended
// over bordered cards. No build step: Orca strips the types and compiles the JSX on load.
// It has no network: every piece of data comes from the worker through plugin.request and the
// rr.changed push, and every request needs a .catch (an unhandled rejection fails tests and
// `orca plugin check`).
//
// Tabs: To review holds Review Requests without a Review Workspace, In review those with one
// (#27), Ended the Ended Review Requests (#28). Later slices fill a tab by changing what
// stagesOf() returns for it. #24: in Body(), a broken connection gets a warning above the tabs
// that opens the Settings view (settings-view.tsx: the connection with the setup checklist, then
// every setting), and the refresh problem sits above them on a failed poll.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  EmptyState,
  Heading,
  host,
  IconButton,
  Link,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Spinner,
  Stack,
  Tab,
  Tabs,
  Text,
  ui,
  update,
  type IconName,
  type Tone,
  type OrcaNode,
  type PanelContext
} from 'orca'
import type { CiStatus, ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'
import { canPostReviews, connectionProblem, loadConnection } from './connection-section'
import { messageOf } from './errors'
import { MinuteTime, setupClock } from './minute-time'
import { RefreshProblem } from './refresh-problem'
import { headline, type NeedsYouView } from './setup-checklist'
import { EndedList, WorkspacesUnavailable } from './ended-tab'
import {
  isReviewDraftOpen,
  openReviewDraft,
  openReviewDraftToPost,
  ReviewDraftScreen,
  setupReviewDraft
} from './review-draft-view'
import { API_SCOPE_HINT } from './review-post-view'
import { isSettingsOpen, openSettings, SettingsScreen, setupSettings } from './settings-view'

type TabId = 'todo' | 'in' | 'ended'

/** The worker's last answer; null until it answers. */
const snapshot = atom<ReviewRequestsSnapshot | null>(null)
/** Why the worker could not answer, if it could not. */
const failure = atom<string | null>(null)
/** True while a refresh the person asked for runs. */
const refreshing = atom(false)
/** The selected tab, kept across reloads. */
const selectedTab = atom<TabId>('rr.tab', 'todo', { persist: 'plugin' })
/** Per-card action errors, by Review Request URL. */
const cardErrors = atom<Record<string, string>>({})
/** Review Request URLs with a workspace action under way (#27); their buttons wait. */
const busyCards = atom<Record<string, true>>({})

function received(answer: ReviewRequestsSnapshot): void {
  set(snapshot, answer)
  set(failure, null)
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('rr.changed', received))
  plugin
    .request('rr.snapshot')
    .then(received)
    .catch((error: unknown) => set(failure, messageOf(error)))
  // Opening the panel shows its Review Requests: the bell stops counting them as new (#10).
  plugin.request('rr.markSeen').catch(() => {})
  setupReviewDraft()
  setupSettings(ctx)
  setupClock(ctx)
  void loadConnection()
}

function refresh(): void {
  set(refreshing, true)
  plugin
    .request('rr.refresh', undefined, { timeoutMs: 120_000 })
    .then(received)
    .catch((error: unknown) => set(failure, messageOf(error)))
    .finally(() => set(refreshing, false))
  void loadConnection()
}

function setCardError(url: string, message: string | null): void {
  update(cardErrors, (errors) => {
    const next = { ...errors }
    if (message === null) delete next[url]
    else next[url] = message
    return next
  })
}

function openInGitLab(url: string): void {
  host
    .call('shell.openExternal', { url })
    .then(() => setCardError(url, null))
    .catch((error: unknown) => setCardError(url, `Couldn't open the link: ${messageOf(error)}`))
}

function setBusy(url: string, busy: boolean): void {
  update(busyCards, (all) => {
    const next = { ...all }
    if (busy) next[url] = true
    else delete next[url]
    return next
  })
}

/** Runs a workspace action for a card: busy while it runs, its error on the card after. */
function cardAction(url: string, failed: string, action: () => Promise<unknown>): void {
  setBusy(url, true)
  setCardError(url, null)
  action()
    .catch((error: unknown) => setCardError(url, `${failed}: ${messageOf(error)}`))
    .finally(() => setBusy(url, false))
}

/**
 * Creating a workspace runs git fetch and Orca's setup. 120 s is the longest a panel request may
 * wait; if it runs longer, the card says so and the worker's rr.changed push moves it when done.
 */
const START_TIMEOUT_MS = 120_000

function startReview(url: string, withAgent: boolean): void {
  cardAction(url, "Couldn't create the Review Workspace", () =>
    plugin.request('rr.startReview', { url, withAgent }, { timeoutMs: START_TIMEOUT_MS }).then(received)
  )
}

function openWorkspace(url: string): void {
  cardAction(url, "Couldn't open the workspace", () => plugin.request('rr.openWorkspace', { url }))
}

function runAgentReview(url: string): void {
  cardAction(url, "Couldn't start the Agent Review", () =>
    plugin.request('rr.runAgentReview', { url }, { timeoutMs: 120_000 })
  )
}

export default function Panel() {
  // #29: an open Review Draft takes the whole panel; its Back button returns here.
  if (isReviewDraftOpen()) return <ReviewDraftScreen />
  if (isSettingsOpen()) {
    const current = read(snapshot)
    return (
      <SettingsScreen
        needsYou={needsYouOf(current)}
        checking={read(refreshing)}
        onCheckAgain={refresh}
        onSnapshot={received}
        invalidFilterEntries={current?.invalidFilterEntries ?? []}
      />
    )
  }
  return (
    <Stack gap="md">
      <Header />
      <Body />
      <FilterNotes />
    </Stack>
  )
}

function Header() {
  const current = read(snapshot)
  const count = current?.reviewRequests.length ?? 0
  return (
    <Row justify="between">
      <Row gap="sm">
        <Heading level={2}>Review Requests</Heading>
        {current !== null && <Badge tone={count > 0 ? 'accent' : 'neutral'}>{String(count)}</Badge>}
      </Row>
      <Row gap="sm">
        {read(refreshing) ? (
          <Spinner label="Refreshing" labelHidden />
        ) : (
          current?.refreshedAt != null && (
            <Text muted size="xs">
              <When at={current.refreshedAt} />
            </Text>
          )
        )}
        <IconButton icon="refresh" label="Refresh" variant="ghost" size="sm" onPress={refresh} />
        <IconButton icon="settings" label="Settings" variant="ghost" size="sm" onPress={openSettings} />
      </Row>
    </Row>
  )
}

/** The footer about the filter settings (#26): ignored entries, and how many it hides. */
function FilterNotes() {
  const current = read(snapshot)
  if (current === null) return null
  const hidden = current.hiddenByFilters ?? 0
  const invalid = current.invalidFilterEntries ?? []
  if (hidden === 0 && invalid.length === 0) return null
  return (
    <Stack gap="xs">
      {invalid.length > 0 && (
        <Callout tone="warning" icon="filter" title="Some filter entries are ignored">
          <Stack gap="xs">
            <Text>{`Not a valid path or username: ${invalid.join(', ')}.`}</Text>
            <Row>
              <Button size="xs" variant="outline" icon="settings" onPress={openSettings}>
                Fix in Settings
              </Button>
            </Row>
          </Stack>
        </Callout>
      )}
      {hidden > 0 && (
        <Row gap="xs" align="center">
          <Text muted size="xs">
            {`${hidden} hidden by filters ·`}
          </Text>
          <Link onPress={openSettings}>change them in Settings</Link>
        </Row>
      )}
    </Stack>
  )
}

/** GitLab needs setting up (#24): polling stopped until the person fixes the connection. */
function needsYouOf(current: ReviewRequestsSnapshot | null): NeedsYouView | null {
  const gitlab = current?.gitlab
  return gitlab?.status === 'needs-you' ? gitlab : null
}

/**
 * What is wrong with the connection, while it is broken: GitLab needs setting up, or the
 * connection check failed. A transient failure has its own line (RefreshProblem) instead.
 */
function brokenConnection(current: ReviewRequestsSnapshot): string | null {
  const needsYou = needsYouOf(current)
  if (needsYou !== null) return headline(needsYou)
  if (current.gitlab?.status === 'retrying') return null
  return connectionProblem()
}

/** A broken connection, above the tabs: the details and the fix are in the Settings view. */
function ConnectionWarning(props: { problem: string }) {
  return (
    <Callout tone="warning" icon="plug" title="GitLab connection needs attention">
      <Stack gap="xs">
        <Text>{props.problem}</Text>
        <Row>
          <Button size="xs" variant="outline" icon="settings" onPress={openSettings}>
            Open Settings
          </Button>
        </Row>
      </Stack>
    </Callout>
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
  const gitlab = current.gitlab
  const broken = brokenConnection(current)
  return (
    <Stack gap="md">
      {broken !== null && <ConnectionWarning problem={broken} />}
      {gitlab?.status === 'retrying' && (
        <RefreshProblem problem={gitlab} retrying={read(refreshing)} onRetry={refresh} />
      )}
      <StageTabs snapshot={current} />
    </Stack>
  )
}

type Stage = { id: TabId; title: string; count: number; overdue: boolean; body: OrcaNode }

function cardStage(id: TabId, title: string, cards: ReviewRequestCard[], empty: OrcaNode): Stage {
  const body =
    cards.length === 0 ? empty : (
      <Stack gap="sm">
        {cards.map((c) => (
          <Card key={c.url} card={c} />
        ))}
      </Stack>
    )
  return { id, title, count: cards.length, overdue: cards.some((c) => c.overdue), body }
}

function stagesOf(current: ReviewRequestsSnapshot): Stage[] {
  const nothingHere = (
    <Text muted size="sm">
      Nothing here.
    </Text>
  )
  const inReview = (c: ReviewRequestCard) => c.workspace != null
  const ended = current.ended ?? []
  return [
    cardStage(
      'todo',
      'To review',
      current.reviewRequests.filter((c) => !inReview(c)),
      <EmptyState icon="check" title="Nothing to review" />
    ),
    cardStage('in', 'In review', current.reviewRequests.filter(inReview), nothingHere),
    {
      id: 'ended',
      title: 'Ended',
      count: ended.length,
      overdue: false,
      body:
        ended.length === 0 ? nothingHere : (
          <EndedList cards={ended} disabled={current.workspacesUnavailable !== undefined} received={received} />
        )
    }
  ]
}

function StageTabs({ snapshot: current }: { snapshot: ReviewRequestsSnapshot }) {
  const unavailable = current.workspacesUnavailable
  if (unavailable === undefined) return <StageTabsOnly snapshot={current} />
  return (
    <Stack gap="md">
      <WorkspacesUnavailable reason={unavailable} />
      <StageTabsOnly snapshot={current} />
    </Stack>
  )
}

function StageTabsOnly({ snapshot: current }: { snapshot: ReviewRequestsSnapshot }) {
  const stages = stagesOf(current)
  const icon = (stage: Stage): IconName | undefined => (stage.overdue ? 'warning' : undefined)

  // `Table` taught us the catalog can list what this Orca doesn't draw (#10): check first.
  if (!ui.has('Tabs')) {
    return (
      <Stack gap="md">
        {stages.map((stage) => (
          <Stack key={stage.id} gap="sm">
            <Heading level={3}>{`${stage.title} ${stage.count}`}</Heading>
            {stage.body}
          </Stack>
        ))}
      </Stack>
    )
  }
  return (
    <Tabs label="Stage" value={read(selectedTab)} onChange={(value) => set(selectedTab, value as TabId)}>
      {stages.map((stage) => (
        <Tab key={stage.id} value={stage.id} label={`${stage.title} ${stage.count}`} icon={icon(stage)}>
          {stage.body}
        </Tab>
      ))}
    </Tabs>
  )
}

/** "3d ago", "just now": never seconds (minute-time.tsx). */
function When({ at, overdue = false }: { at: number; overdue?: boolean }) {
  return <MinuteTime at={at} tone={overdue ? 'danger' : undefined} />
}

/** Start review (plus its Agent Review button), or Open workspace and Run Agent Review (#6). */
function WorkspaceActions({ card }: { card: ReviewRequestCard }) {
  const busy = read(busyCards)[card.url] === true
  if (card.workspace != null) {
    return (
      <Row gap="xs">
        <Button size="xs" icon="folder" disabled={busy} onPress={() => openWorkspace(card.url)}>
          Open workspace
        </Button>
        <IconButton
          icon="agent"
          label="Run Agent Review"
          variant="ghost"
          size="xs"
          disabled={busy}
          onPress={() => runAgentReview(card.url)}
        />
        <Button size="xs" variant="outline" icon="edit" onPress={() => openReviewDraft(card.url)}>
          Review draft
        </Button>
        {(card.toPost ?? 0) > 0 && (
          <Button
            size="xs"
            icon="upload"
            disabled={canPostReviews() === false}
            tooltip={canPostReviews() === false ? API_SCOPE_HINT : 'Post the Review Draft to GitLab as one review'}
            onPress={() => openReviewDraftToPost(card.url)}
          >
            {`Post ${card.toPost} to GitLab`}
          </Button>
        )}
        {busy && <Spinner label="Working" labelHidden />}
      </Row>
    )
  }
  const blocked = card.startBlocked ?? null
  return (
    <Row gap="xs">
      <Button
        size="xs"
        icon="play"
        disabled={busy || blocked !== null}
        tooltip={blocked ?? 'Create a Review Workspace for this merge request'}
        onPress={() => startReview(card.url, false)}
      >
        Start review
      </Button>
      <IconButton
        icon="agent"
        label="Start review with Agent Review"
        tooltip={blocked ?? 'Create the Review Workspace and start an Agent Review in it'}
        variant="ghost"
        size="xs"
        disabled={busy || blocked !== null}
        onPress={() => startReview(card.url, true)}
      />
      {busy && <Spinner label="Creating the Review Workspace" labelHidden />}
    </Row>
  )
}

const CI_BADGES: Record<CiStatus, { text: string; tone: Tone }> = {
  passed: { text: 'CI passed', tone: 'success' },
  failed: { text: 'CI failed', tone: 'danger' },
  running: { text: 'CI running', tone: 'neutral' }
}

/** CI, approvals given/required and comments (#10); each only when there is something to say. */
function StatusBadges({ card }: { card: ReviewRequestCard }) {
  const ci = card.ci == null ? null : CI_BADGES[card.ci]
  const comments = card.comments ?? 0
  if (ci === null && card.approvals == null && comments === 0) return null
  return (
    <Row gap="xs" wrap>
      {ci !== null && <Badge tone={ci.tone}>{ci.text}</Badge>}
      {card.approvals != null && <Badge>{`${card.approvals.given}/${card.approvals.required} approvals`}</Badge>}
      {comments > 0 && <Badge>{comments === 1 ? '1 comment' : `${comments} comments`}</Badge>}
    </Row>
  )
}

/** "Agent Review running", or "Agent Review done · N comments ready" (#10). */
function agentReviewLine(card: ReviewRequestCard): string | null {
  const review = card.agentReview
  if (card.workspace == null || review == null) return null
  if (review.state === 'running') return 'Agent Review running'
  const ready = review.commentsReady
  if (ready === 0) return 'Agent Review done'
  return `Agent Review done · ${ready === 1 ? '1 comment' : `${ready} comments`} ready`
}

function Card({ card }: { card: ReviewRequestCard }) {
  const error = read(cardErrors)[card.url]
  const blocked = card.workspace == null ? (card.startBlocked ?? null) : null
  // Overdue takes precedence over New (#10).
  const isNew = card.isNew === true && !card.overdue
  const agentLine = agentReviewLine(card)
  return (
    <Box border={card.overdue ? 'danger' : isNew ? 'accent' : true} radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="start">
        <Text weight="semibold">{card.title}</Text>
        {card.overdue && <Badge tone="danger">Overdue</Badge>}
        {isNew && <Badge tone="accent">New</Badge>}
      </Row>
      <Text muted size="xs">
        <Link onPress={() => openInGitLab(card.url)}>{`${card.projectPath} !${card.iid}`}</Link>
        {` · ${card.author} · requested `}
        <When at={card.requestedAt} overdue={card.overdue} />
      </Text>
      <StatusBadges card={card} />
      {agentLine !== null && (
        <Row gap="xs" align="center">
          {card.agentReview?.state === 'running' && <Spinner label="Agent Review running" labelHidden />}
          <Text size="xs">{agentLine}</Text>
        </Row>
      )}
      <WorkspaceActions card={card} />
      {blocked !== null && (
        <Text muted size="xs">
          {blocked}
        </Text>
      )}
      {error !== undefined && (
        <Text tone="danger" size="xs">
          {error}
        </Text>
      )}
    </Box>
  )
}
