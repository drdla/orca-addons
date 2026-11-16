// The Review Requests panel (#10 variant D): a header, then tabs To review / In review / Ended
// over bordered cards. No build step: Orca strips the types and compiles the JSX on load.
// It has no network: every piece of data comes from the worker through plugin.request and the
// rr.changed push, and every request needs a .catch (an unhandled rejection fails tests and
// `orca plugin check`).
//
// Tabs: To review holds Review Requests without a Review Workspace (all of them until #27),
// In review those with one (#27), Ended the Ended Review Requests (#28). Later slices fill a tab
// by changing what tabContents() returns for it. #24: in Body(), the setup checklist replaces the
// tabs while GitLab needs setting up, and the refresh problem sits above them on a failed poll.
import {
  atom,
  Badge,
  Box,
  Callout,
  EmptyState,
  Heading,
  host,
  IconButton,
  plugin,
  read,
  RelativeTime,
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
  type OrcaNode,
  type PanelContext
} from 'orca'
import type { ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'
import { RefreshProblem } from './refresh-problem'
import { SetupChecklist } from './setup-checklist'

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
}

function refresh(): void {
  set(refreshing, true)
  plugin
    .request('rr.refresh', undefined, { timeoutMs: 120_000 })
    .then(received)
    .catch((error: unknown) => set(failure, messageOf(error)))
    .finally(() => set(refreshing, false))
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

function copyLink(url: string): void {
  plugin
    .request('rr.copyLink', { url })
    .then(() => setCardError(url, null))
    .catch((error: unknown) => setCardError(url, `Couldn't copy the link: ${messageOf(error)}`))
}

export default function Panel() {
  return (
    <Stack gap="md">
      <Header />
      <Body />
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
      </Row>
    </Row>
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
  // #24: GitLab needs setting up: the setup checklist replaces the tabs.
  const gitlab = current.gitlab
  if (gitlab?.status === 'needs-you') {
    return <SetupChecklist problem={gitlab} checking={read(refreshing)} onCheckAgain={refresh} />
  }
  if (gitlab?.status === 'retrying') {
    return (
      <Stack gap="md">
        <RefreshProblem problem={gitlab} retrying={read(refreshing)} onRetry={refresh} />
        <StageTabs snapshot={current} />
      </Stack>
    )
  }
  return <StageTabs snapshot={current} />
}

type Stage = { id: TabId; title: string; cards: ReviewRequestCard[]; empty: OrcaNode }

function stagesOf(current: ReviewRequestsSnapshot): Stage[] {
  const nothingHere = (
    <Text muted size="sm">
      Nothing here.
    </Text>
  )
  return [
    {
      id: 'todo',
      title: 'To review',
      cards: current.reviewRequests,
      empty: <EmptyState icon="check" title="Nothing to review" />
    },
    { id: 'in', title: 'In review', cards: [], empty: nothingHere },
    { id: 'ended', title: 'Ended', cards: [], empty: nothingHere }
  ]
}

function StageTabs({ snapshot: current }: { snapshot: ReviewRequestsSnapshot }) {
  const stages = stagesOf(current)
  const contents = (stage: Stage) =>
    stage.cards.length === 0 ? stage.empty : (
      <Stack gap="sm">
        {stage.cards.map((c) => (
          <Card key={c.url} card={c} />
        ))}
      </Stack>
    )
  const icon = (stage: Stage): IconName | undefined =>
    stage.cards.some((c) => c.overdue) ? 'warning' : undefined

  // `Table` taught us the catalog can list what this Orca doesn't draw (#10): check first.
  if (!ui.has('Tabs')) {
    return (
      <Stack gap="md">
        {stages.map((stage) => (
          <Stack key={stage.id} gap="sm">
            <Heading level={3}>{`${stage.title} ${stage.cards.length}`}</Heading>
            {contents(stage)}
          </Stack>
        ))}
      </Stack>
    )
  }
  return (
    <Tabs label="Stage" value={read(selectedTab)} onChange={(value) => set(selectedTab, value as TabId)}>
      {stages.map((stage) => (
        <Tab key={stage.id} value={stage.id} label={`${stage.title} ${stage.cards.length}`} icon={icon(stage)}>
          {contents(stage)}
        </Tab>
      ))}
    </Tabs>
  )
}

/** "3d ago", kept current by Orca, or a fixed date where RelativeTime isn't drawn. */
function When({ at, overdue = false }: { at: number; overdue?: boolean }) {
  if (!ui.has('RelativeTime')) return <>{new Date(at).toLocaleString()}</>
  return <RelativeTime at={at} format="short" tone={overdue ? 'danger' : undefined} />
}

function Card({ card }: { card: ReviewRequestCard }) {
  const error = read(cardErrors)[card.url]
  return (
    <Box border={card.overdue ? 'danger' : true} radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="start">
        <Text weight="semibold">{card.title}</Text>
        {card.overdue && <Badge tone="danger">Overdue</Badge>}
      </Row>
      <Text muted size="xs">
        {`${card.projectPath} !${card.iid} · ${card.author} · requested `}
        <When at={card.requestedAt} overdue={card.overdue} />
      </Text>
      <Row justify="end" gap="xs">
        <IconButton
          icon="open-external"
          label="Open in GitLab"
          variant="ghost"
          size="xs"
          onPress={() => openInGitLab(card.url)}
        />
        <IconButton icon="copy" label="Copy link" variant="ghost" size="xs" onPress={() => copyLink(card.url)} />
      </Row>
      {error !== undefined && (
        <Text tone="danger" size="xs">
          {error}
        </Text>
      )}
    </Box>
  )
}
