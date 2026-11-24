// The Review Requests panel (#10 variant D): a header, then tabs Todo / Reviewing / Done
// over bordered cards. No build step: Orca strips the types and compiles the JSX on load.
// It has no network: every piece of data comes from the worker through plugin.request and the
// rr.changed push, and every request needs a .catch (an unhandled rejection fails tests and
// `orca plugin check`).
//
// Tabs: Todo holds Review Requests without a Review Workspace, Reviewing those with one
// (#27), Done the Ended Review Requests (#28). Later slices fill a tab by changing what
// stagesOf() returns for it. #24: in Body(), a broken connection gets a warning above the tabs
// that opens the Settings view (settings-view.tsx: the connection with the setup checklist, then
// every setting), and the refresh problem sits above them on a failed poll. The search above the
// tabs narrows all three (search.ts); the ⓘ next to Refresh opens the Manual (manual-view.tsx).
import {
  atom,
  Box,
  Callout,
  EmptyState,
  Heading,
  host,
  IconButton,
  Input,
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
  type PanelContext,
} from 'orca'
import { authorNameOf } from './author'
import { Badge } from './badge'
import { Button } from './button'
import { isManualOpen, ManualScreen, openManual } from './manual-view'
import { MergeRequestTitle } from './merge-request-link'
import type { CiStatus, MyReview, PreviousOutcome, ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'
import { connectionProblem, loadConnection } from './connection-section'
import { messageOf } from './errors'
import { MinuteTime, minuteTimeText, setupClock } from './minute-time'
import { countText, overdueSplit } from './overdue-split'
import { matchesQuery, normalizeQuery, tabWithMatches } from './search'
import { shortTitle } from './short-title'
import { RefreshProblem } from './refresh-problem'
import { headline, type NeedsYouView } from './setup-checklist'
import { EndedList, WorkspacesUnavailable } from './ended-tab'
import { isRemoving, RemovalError, removeWorkspace } from './workspace-removal'
import {
  isReviewDraftOpen,
  openReviewDraft,
  ReviewDraftScreen,
  setupReviewDraft
} from './review-draft-view'
import { hasReviewPrompt, isSettingsOpen, openSettings, SettingsScreen, setupSettings } from './settings-view'

type TabId = 'todo' | 'in' | 'ended'

/** The worker's last answer; null until it answers. */
const snapshot = atom<ReviewRequestsSnapshot | null>(null)
/** Why the worker could not answer, if it could not. */
const failure = atom<string | null>(null)
/** True while a refresh the person asked for runs. */
const refreshing = atom(false)
/** The selected tab, kept across reloads. */
const selectedTab = atom<TabId>('rr.tab', 'todo', { persist: 'plugin' })
/** What the search input holds: kept across polls and tab switches, not across reloads. */
const searchQuery = atom('')
/** The Review Request whose review was started last in this panel: first on Reviewing until a reload. */
const justStarted = atom<string | null>(null)
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
  // Opening the panel shows its Review Requests: the status bar item stops counting them as new (#10).
  plugin.request('rr.markSeen').catch(() => {})
  setupReviewDraft(ctx)
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
 * Creating a workspace runs two git fetches, the create and a reset. 120 s is the longest a panel request may
 * wait; if it runs longer, the card says so and the worker's rr.changed push moves it when done.
 */
const START_TIMEOUT_MS = 120_000

function startReview(url: string, withAgent: boolean): void {
  cardAction(url, "Couldn't create the Review Workspace", () =>
    plugin
      .request('rr.startReview', { url, withAgent }, { timeoutMs: START_TIMEOUT_MS })
      .then((answer) => {
        received(answer)
        // Show the new Reviewing card: that tab, with the card on top.
        set(justStarted, url)
        set(selectedTab, 'in')
      })
  )
}

function openWorkspace(url: string): void {
  cardAction(url, "Couldn't open the workspace", () => plugin.request('rr.openWorkspace', { url }))
}

/** The merge request summary: the workspace's Review Cover Page (#55). */
function openCoverPage(url: string): void {
  cardAction(url, "Couldn't open the merge request summary", () =>
    plugin.request('rr.openCoverPage', { url }, { timeoutMs: 60_000 })
  )
}

/** Orca's Source Control sidebar in the workspace, for its changed files. */
function showChanges(url: string): void {
  cardAction(url, "Couldn't show the changed files", () => plugin.request('rr.showChanges', { url }))
}

/**
 * "Update workspace" (#57): fetches, hard-resets the clean workspace and rebuilds its Review Cover
 * Page. A refusal (uncommitted changes, commits of the reviewer's own) shows on the card.
 */
function updateWorkspace(url: string): void {
  cardAction(url, "Couldn't update the workspace", () =>
    plugin.request('rr.updateWorkspace', { url }, { timeoutMs: START_TIMEOUT_MS }).then(received)
  )
}

export default function Panel() {
  // #29: an open Review Draft takes the whole panel; its Back button returns here.
  // A review posted to its end goes straight to the Done tab.
  if (isReviewDraftOpen()) return <ReviewDraftScreen onSnapshot={received} onDone={() => set(selectedTab, 'ended')} />
  if (isManualOpen()) return <ManualScreen />
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
  // The panel's full height: the list scrolls on its own, the footer stays at the bottom.
  return (
    <Box direction="column" height="100%" gap="xs">
      <Box grow scroll="y">
        <Stack gap="md">
          <Header />
          <Body />
          <FilterNotes />
        </Stack>
      </Box>
      <Box shrink={false}>
        <Footer />
      </Box>
    </Box>
  )
}

/**
 * Refresh as one borderless, text-like button: the icon and when the list was last refreshed; just
 * the icon before the first refresh.
 */
function RefreshButton({ refreshedAt }: { refreshedAt: number | null }) {
  // While refreshing it is just disabled: no spinner.
  if (refreshedAt === null) {
    return (
      <IconButton icon="refresh" label="Refresh" variant="ghost" size="sm" disabled={read(refreshing)} onPress={refresh} />
    )
  }
  return (
    <Button
      size="xs"
      variant="ghost"
      tone="neutral"
      icon="refresh"
      tooltip="Refresh"
      disabled={read(refreshing)}
      onPress={refresh}
    >
      {minuteTimeText(refreshedAt)}
    </Button>
  )
}

function Header() {
  const current = read(snapshot)
  return (
    <Row gap="sm">
      <Heading level={2}>Review Requests</Heading>
      {current !== null && <HeadingCounts key="heading-counts" cards={current.reviewRequests} />}
    </Row>
  )
}

/** The row at the bottom of the panel: Refresh on the left, the Manual and Settings on the right. */
function Footer() {
  const current = read(snapshot)
  return (
    <Row justify="between" align="center">
      <RefreshButton refreshedAt={current?.refreshedAt ?? null} />
      {/* No gap: the ghost buttons' own padding already spaces them. */}
      <Row gap="none" align="center">
        <IconButton icon="info" label="Manual" variant="ghost" size="sm" onPress={openManual} />
        <IconButton icon="settings" label="Settings" variant="ghost" size="sm" onPress={openSettings} />
      </Row>
    </Row>
  )
}

/**
 * The heading's count, split like the status bar item (#53): one pill holding the Review Requests
 * not yet overdue, dimmed, and the Overdue Review Requests in the strong text colour, each hidden
 * at 0; a "0" when there are none. While any is overdue the pill gets a red tint and outline. A Box styled as a
 * pill, not a Badge: Orca's renderer accepts only text inside a Badge.
 */
function HeadingCounts({ cards }: { cards: readonly ReviewRequestCard[] }) {
  const { inTime, overdue } = overdueSplit(cards)
  const showInTime = inTime > 0 || overdue === 0
  return (
    <Box
      direction="row"
      align="center"
      gap="xs"
      paddingX="sm"
      radius="full"
      background={overdue > 0 ? 'danger' : 'muted'}
      border={overdue > 0 ? 'danger' : false}
    >
      {showInTime && (
        <Text muted size="sm" weight="medium">
          {String(inTime)}
        </Text>
      )}
      {showInTime && overdue > 0 && (
        <Text muted size="sm">
          |
        </Text>
      )}
      {overdue > 0 && (
        <Text size="sm" weight="semibold">
          {String(overdue)}
        </Text>
      )}
    </Box>
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

/** A tab: `count` is how many cards it has; `countLabel` writes it like the status bar ("2 | 3!"). */
type Stage = { id: TabId; title: string; count: number; countLabel: string; body: OrcaNode }

function cardStage(id: TabId, title: string, cards: ReviewRequestCard[], empty: OrcaNode): Stage {
  const body =
    cards.length === 0 ? empty : (
      <Stack gap="sm">
        {cards.map((c) => (
          <Card key={c.url} card={c} />
        ))}
      </Stack>
    )
  return { id, title, count: cards.length, countLabel: countText(overdueSplit(cards)), body }
}

/**
 * Under Reviewing: the review has a Review Workspace and the user is reviewing this round. A
 * re-requested card stays under Todo with its old workspace until Start review reuses it (#79).
 */
function inReview(card: ReviewRequestCard): boolean {
  return card.workspace != null && card.reRequested == null
}

/**
 * The tabs, each narrowed to the cards matching the search. While a search finds nothing on a tab,
 * its empty state says so, worded like the tab's usual one.
 */
function stagesOf(current: ReviewRequestsSnapshot, query: string): Stage[] {
  const normalized = normalizeQuery(query)
  const searching = normalized !== ''
  const matching = <T extends { url: string; title: string }>(cards: readonly T[]) =>
    cards.filter((c) => matchesQuery(c, normalized))
  const noMatch = (icon: IconName, what: string) => (
    <EmptyState icon={icon} title={`No ${what} matching "${query.trim()}"`} />
  )
  const cards = matching(current.reviewRequests)
  const ended = matching(current.ended ?? [])
  return [
    cardStage(
      'todo',
      'Todo',
      cards.filter((c) => !inReview(c)),
      searching ? noMatch('check', 'open review requests') : <EmptyState icon="check" title="No open review requests" />
    ),
    cardStage(
      'in',
      'Reviewing',
      startedFirst(cards.filter(inReview), read(justStarted)),
      searching ? noMatch('folder', 'reviews in progress') : <EmptyState icon="folder" title="No reviews in progress" />
    ),
    {
      id: 'ended',
      title: 'Done',
      count: ended.length,
      countLabel: String(ended.length),
      body:
        ended.length === 0 ?
          searching ? noMatch('check', 'completed reviews')
          : <EmptyState icon="check" title="No completed reviews" />
        : <EndedList cards={ended} disabled={current.workspacesUnavailable !== undefined} received={received} />
    }
  ]
}

/** The cards with the one whose review was just started first; the others keep their order. */
function startedFirst(cards: ReviewRequestCard[], url: string | null): ReviewRequestCard[] {
  const started = cards.find((c) => c.url === url)
  return started === undefined ? cards : [started, ...cards.filter((c) => c !== started)]
}

/** Each tab's number of cards matching a search. */
function matchCounts(current: ReviewRequestsSnapshot, query: string): Record<TabId, number> {
  const counts = { todo: 0, in: 0, ended: 0 }
  for (const stage of stagesOf(current, query)) counts[stage.id] = stage.count
  return counts
}

/**
 * Typing narrows the tabs. When the selected tab has no match but exactly one other tab does,
 * that tab is selected, so a pasted link lands on its card wherever it is.
 */
function search(query: string): void {
  set(searchQuery, query)
  const current = read(snapshot)
  if (current === null || normalizeQuery(query) === '') return
  set(selectedTab, tabWithMatches(matchCounts(current, query), read(selectedTab)))
}

/** The search, full width above the tabs. A search input: Orca draws its own clear button. */
function SearchInput() {
  return (
    <Input
      type="search"
      label="Search Review Requests"
      labelHidden
      placeholder="Search title or URL"
      value={read(searchQuery)}
      onChange={search}
    />
  )
}

/** A tab's name and its count, for example "Todo · 3" or "Todo · 2 | 3!"; just the name at 0. */
function labelOf(stage: Stage): string {
  return stage.count === 0 ? stage.title : `${stage.title} · ${stage.countLabel}`
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
  const stages = stagesOf(current, read(searchQuery))

  // `Table` taught us the catalog can list what this Orca doesn't draw (#10): check first.
  if (!ui.has('Tabs')) {
    return (
      <Stack gap="md">
        <SearchInput />
        {stages.map((stage) => (
          <Stack key={stage.id} gap="sm">
            <Heading level={3}>{labelOf(stage)}</Heading>
            {stage.body}
          </Stack>
        ))}
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <SearchInput />
      <Tabs label="Stage" value={read(selectedTab)} onChange={(value) => set(selectedTab, value as TabId)}>
        {stages.map((stage) => (
          <Tab key={stage.id} value={stage.id} label={labelOf(stage)}>
            {stage.body}
          </Tab>
        ))}
      </Tabs>
    </Stack>
  )
}

/** "3d ago", "just now": never seconds (minute-time.tsx). */
function When({ at }: { at: number }) {
  return <MinuteTime at={at} />
}

/**
 * A Reviewing card's ways into its Review Workspace (#6): open it, its changed files and the
 * merge request summary, then what holds the merge request up. Their own row, above the actions;
 * nothing on a Todo card.
 */
function WorkspaceNavigation({ card }: { card: ReviewRequestCard }) {
  if (!inReview(card)) return null
  const busy = read(busyCards)[card.url] === true
  // Two groups, further apart than the buttons within them; Remove workspace (#80) on its own at
  // the far end, away from the ways in and from Finish Review.
  return (
    <Row justify="between" align="center" gap="md">
      <Row gap="md" align="center" wrap>
        <Row gap="xs" align="center">
          <IconButton
            icon="folder"
            label="Open workspace"
            variant="ghost"
            size="xs"
            disabled={busy}
            onPress={() => openWorkspace(card.url)}
          />
          <IconButton
            icon="branch"
            label="View changes"
            variant="ghost"
            size="xs"
            disabled={busy}
            onPress={() => showChanges(card.url)}
          />
          <IconButton
            icon="file-text"
            label="View MR summary"
            variant="ghost"
            size="xs"
            disabled={busy}
            onPress={() => openCoverPage(card.url)}
          />
        </Row>
        {blockers(card).length > 0 && (
          <Row gap="xs" align="center">
            <Blockers card={card} />
          </Row>
        )}
      </Row>
      <RemoveWorkspaceButton card={card} />
    </Row>
  )
}

/** A review in progress's Remove workspace (#80): removes at once, as on Done. */
function RemoveWorkspaceButton({ card }: { card: ReviewRequestCard }) {
  const unavailable = read(snapshot)?.workspacesUnavailable !== undefined
  const busy = read(busyCards)[card.url] === true || isRemoving(card.url)
  return (
    <IconButton
      icon="delete"
      label="Delete workspace"
      tooltip="Delete workspace"
      variant="ghost"
      size="xs"
      disabled={busy || unavailable}
      onPress={() => removeWorkspace(card.url, received)}
    />
  )
}

/** Start review, or Finish Review (the Review Draft) and the other actions on the Review Workspace (#6). */
function WorkspaceActions({ card }: { card: ReviewRequestCard }) {
  const busy = read(busyCards)[card.url] === true
  if (inReview(card)) {
    // New commits on the merge request: Pull Changes comes first and is the notice too; Finish
    // Review stays disabled until they are pulled, as a review of the old commits is out of date.
    const behind = card.mergeRequestUpdated === true
    return (
      <Row gap="xs" align="center" wrap>
        {behind && (
          <Button
            size="xs"
            variant="outline"
            icon="refresh"
            disabled={busy}
            tooltip="Update workspace with changes from MR"
            onPress={() => updateWorkspace(card.url)}
          >
            Pull Changes
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          icon="check"
          disabled={behind}
          tooltip={
            behind
              ? 'Pull the changes first'
              : 'Pick the comments, the outcome and a summary, then post them to GitLab as one review'
          }
          onPress={() => openReviewDraft(card.url)}
        >
          Finish Review
        </Button>
        {/* Another Agent Review runs from the Finish Review page; the card only shows one at work.
            Orca gives a Spinner no tooltip, so its label is for screen readers only. */}
        {card.agentReview?.state === 'running' && <Spinner label="Agent Review in progress" labelHidden />}
        <MyReviewBadge card={card} />
        {busy && <Spinner label="Working" labelHidden />}
      </Row>
    )
  }
  // A re-requested card may still have its old workspace (#79): Start review reuses it.
  const reuse = card.workspace != null
  const blocked = reuse ? null : (card.startBlocked ?? null)
  // With a Review Prompt set, every Start review also starts an Agent Review.
  const withAgent = hasReviewPrompt()
  const hint =
    reuse ?
      withAgent ?
        "Move the Review Workspace to the merge request's new commits and start an Agent Review in it"
      : "Move the Review Workspace to the merge request's new commits"
    : withAgent ? 'Create the Review Workspace for this merge request and start an Agent Review in it'
    : 'Create a Review Workspace for this merge request'
  return (
    <Row gap="xs" align="center" wrap>
      <Button
        size="xs"
        icon="play"
        disabled={busy || blocked !== null}
        tooltip={blocked ?? hint}
        onPress={() => startReview(card.url, withAgent)}
      >
        Start Review
      </Button>
      <PreviousOutcomeBadge card={card} />
      {reuse && <RemoveWorkspaceButton card={card} />}
      {busy && <Spinner label={reuse ? 'Updating the Review Workspace' : 'Creating the Review Workspace'} labelHidden />}
    </Row>
  )
}

/**
 * What the user did last round, on a re-requested card (#79), with the status dot every review
 * outcome uses: approved success, changes requested warning, commented accent.
 */
const PREVIOUS_OUTCOME: Record<PreviousOutcome, { tone: Tone; text: string }> = {
  approved: { tone: 'success', text: 'Approved' },
  'changes-requested': { tone: 'warning', text: 'Changes requested' },
  commented: { tone: 'accent', text: 'Commented' }
}

function PreviousOutcomeBadge({ card }: { card: ReviewRequestCard }) {
  if (card.reRequested == null) return null
  const badge = PREVIOUS_OUTCOME[card.reRequested]
  return <Badge tone={badge.tone}>{badge.text}</Badge>
}

/**
 * The user's own review so far, as a Badge after the agent button. Only "Commented": approving or
 * requesting changes ends the Review Request (#78), and the Done tab's card says so.
 */
const MY_REVIEW: Record<MyReview, { tone: Tone; text: string }> = {
  commented: { tone: 'accent', text: 'Commented' }
}

function MyReviewBadge({ card }: { card: ReviewRequestCard }) {
  if (card.myReview == null) return null
  const badge = MY_REVIEW[card.myReview]
  return <Badge tone={badge.tone}>{badge.text}</Badge>
}

/** Only CI that holds a review up blocks it: a passed pipeline, or none, has nothing to say. */
const CI_BLOCKERS: Record<CiStatus, string | null> = {
  passed: null,
  failed: 'CI failed',
  running: 'CI running'
}

/** What holds the review up: CI still running or failed, then open comments; empty when nothing does. */
function blockers(card: ReviewRequestCard): { text: string; url: string }[] {
  const ci = card.ci == null ? null : CI_BLOCKERS[card.ci]
  const comments = card.comments ?? 0
  return [
    ...(ci === null ? [] : [{ text: ci, url: `${card.url}/pipelines` }]),
    ...(comments === 0
      ? []
      : [{ text: comments === 1 ? '1 open comment' : `${comments} open comments`, url: card.url }])
  ]
}

/**
 * What holds the merge request up, mid-dot separated ("CI failed · 1 open comment"), after the
 * card's buttons; nothing when nothing does. Each is a link: CI to the MR's pipelines, open
 * comments to the MR, where its threads are. Each piece is its own node so the Row's gap spaces
 * the dots evenly.
 */
function Blockers({ card }: { card: ReviewRequestCard }) {
  return blockers(card).flatMap((blocker, index) => [
    ...(index > 0
      ? [
          <Text key={`dot-${index}`} muted size="xs">
            ·
          </Text>
        ]
      : []),
    // Link has no size: the Text around it makes it xs, like the author and age.
    <Text key={blocker.text} size="xs">
      <Link onPress={() => openInGitLab(blocker.url)}>{blocker.text}</Link>
    </Text>
  ])
}

/** Approvals given/required (#10), when the merge request asks for any. */
function Approvals({ card }: { card: ReviewRequestCard }) {
  if (card.approvals == null) return null
  return (
    <Row>
      <Badge>{`${card.approvals.given}/${card.approvals.required} approvals`}</Badge>
    </Row>
  )
}

function Card({ card }: { card: ReviewRequestCard }) {
  const error = read(cardErrors)[card.url]
  const blocked = card.workspace == null ? (card.startBlocked ?? null) : null
  // Overdue takes precedence over New (#10), and so does Re-requested (#79).
  const isNew = card.isNew === true && !card.overdue && card.reRequested == null
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="start">
        <MergeRequestTitle
          url={card.url}
          iid={card.iid}
          title={shortTitle(card.title)}
          author={authorNameOf(card)}
          onOpen={openInGitLab}
        />
        {card.overdue && <Badge tone="danger">Late</Badge>}
        {card.reRequested != null && <Badge tone="accent">Follow-up</Badge>}
        {isNew && <Badge tone="accent">New</Badge>}
      </Row>
      <Approvals card={card} />
      <WorkspaceNavigation card={card} />
      {/* The age, short and muted like Orca's workspace list ("40m", "2h"), stays right on one
          line (muted even when overdue: the Late badge says that), centred on the buttons' row: the buttons wrap before it does. */}
      <Box direction="row" justify="between" align="center" gap="xs">
        <Box grow>
          <Row gap="sm" align="center" wrap>
            <WorkspaceActions card={card} />
            {/* A Reviewing card shows them after its navigation buttons instead. */}
            {!inReview(card) && <Blockers card={card} />}
          </Row>
        </Box>
        <Box shrink={false}>
          <Text muted size="xs">
            <MinuteTime at={card.requestedAt} age />
          </Text>
        </Box>
      </Box>
      {blocked !== null && (
        <Text muted size="xs">
          {blocked}
        </Text>
      )}
      <RemovalError url={card.url} />
      {error !== undefined && (
        <Text tone="danger" size="xs">
          {error}
        </Text>
      )}
    </Box>
  )
}
