// PROTOTYPE — throwaway. Answers "How should the panel and status-bar item look?"
// (drdla/orca-addons#10). Three structurally different panel variants plus three status-bar
// looks, switched from the PROTOTYPE bar at the bottom of the panel. All data is mocked; every
// action only records "last action" in the bar.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  KeyValue,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  Skeleton,
  Spinner,
  Stack,
  Tab,
  List,
  ListItem,
  ui,
  Tabs,
  Text,
  set,
  type PanelContext
} from 'orca'
import { ended, lastRefreshedAt, reviewRequests, type EndedReviewRequest, type ReviewRequest } from './mock'
import type { PanelState, StatusVariant } from './protocol'

// ---------- prototype switches ----------
const VARIANTS = [
  { key: 'A', name: 'Inbox cards' },
  { key: 'B', name: 'Table + detail' },
  { key: 'C', name: 'Tabs by stage' }
] as const
const variant = atom('proto.variant', 'A', { persist: 'storage' })
const panelState = atom<PanelState>('proto.state', 'loaded', { persist: 'storage' })
const statusVariant = atom<StatusVariant>('proto.status', 'icon-count', { persist: 'storage' })
const lastAction = atom('proto.lastAction', '—')
const statusEcho = atom('proto.statusEcho', '')
const selected = atom<string | null>('proto.selected', 'rr1')

function act(label: string) {
  return () => set(lastAction, label)
}

function visibleRRs(): ReviewRequest[] {
  const s = read(panelState)
  if (s === 'empty' || s === 'setup' || s === 'loading') return []
  // Longest-waiting first.
  return [...reviewRequests].sort((a, b) => a.requestedAt - b.requestedAt)
}
function visibleEnded(): EndedReviewRequest[] {
  const s = read(panelState)
  return s === 'setup' || s === 'loading' ? [] : ended
}

async function pushStatusBar(): Promise<void> {
  const rrs = reviewRequests
  const s = read(panelState)
  const count = s === 'empty' ? 0 : rrs.length
  const newCount = s === 'empty' ? 0 : rrs.filter((r) => r.isNew).length
  try {
    const out = await plugin.request('proto.statusBar', { variant: read(statusVariant), state: s, count, newCount })
    set(statusEcho, out.visible ? `"${out.text}" (${out.tone})` : 'hidden')
  } catch (e) {
    set(statusEcho, `error: ${(e as Error).message}`)
  }
}

export function setup(_ctx: PanelContext): void {
  const used = ['Table', 'List', 'ListItem', 'Tabs', 'Collapsible', 'Callout', 'KeyValue', 'Skeleton', 'EmptyState', 'RelativeTime', 'Box', 'Select', 'Checkbox', 'Spinner']
  console.log('[proto] components missing:', used.filter((c) => !ui.has(c)).join(', ') || 'none', '· catalog', ui.catalog)
  void pushStatusBar()
}

// ---------- shared bits ----------
const pipelineBadge = (p: ReviewRequest['pipeline']) =>
  p === 'success' ? (
    <Badge tone="success">CI passed</Badge>
  ) : p === 'failed' ? (
    <Badge tone="danger">CI failed</Badge>
  ) : p === 'running' ? (
    <Badge tone="accent">CI running</Badge>
  ) : null

function ageText(at: number): string {
  // ListItem description is a plain string, so no RelativeTime here.
  const m = Math.round((Date.now() - at) / 60000)
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

const shortProject = (p: string) => p.split('/').slice(-1)[0]

function agentText(rr: ReviewRequest): string | null {
  const w = rr.workspace
  if (!w) return null
  if (w.agentReview === 'running') return 'Agent Review running'
  if (w.agentReview === 'done') return w.preparedNotes ? `Agent Review done · ${w.preparedNotes} comments ready` : 'Agent Review done'
  return 'Workspace open'
}

function Header(props: { count: number }) {
  const s = read(panelState)
  return (
    <Row justify="between" align="center">
      <Row gap="xs" align="center">
        <Heading level={2}>Review Requests</Heading>
        {s === 'loading' ? null : <Badge tone={props.count ? 'accent' : 'neutral'}>{String(props.count)}</Badge>}
      </Row>
      <Row gap="xs" align="center">
        {s === 'refreshing' ? (
          <Spinner label="Refreshing" labelHidden />
        ) : s === 'loading' || s === 'setup' ? null : (
          <Text muted size="xs">
            <RelativeTime at={lastRefreshedAt} format="short" muted />
          </Text>
        )}
        <IconButton icon="refresh" label="Refresh" size="sm" variant="ghost" onPress={act('Refresh')} disabled={s === 'setup'} />
      </Row>
    </Row>
  )
}

/** Non-list states shared by all variants. Returns null when the variant should draw its list. */
function StateBody() {
  const s = read(panelState)
  if (s === 'setup')
    return (
      <Stack gap="md">
        <Callout tone="warning" icon="plug" title="Connect GitLab">
          <Text size="sm">Neither glab nor a token works for gitlab.com yet.</Text>
        </Callout>
        <Stack gap="xs">
          <Checkbox label="Instance URL set" description="https://gitlab.com" checked disabled />
          <Checkbox label="glab installed" description="/opt/homebrew/bin/glab" checked disabled />
          <Checkbox label="glab logged in to gitlab.com" description="Run: glab auth login --hostname gitlab.com" checked={false} disabled />
        </Stack>
        <Row gap="xs">
          <Button tone="accent" onPress={act('Check again')}>Check again</Button>
          <Button variant="ghost" onPress={act('Use a token instead')}>Use a token instead</Button>
        </Row>
      </Stack>
    )
  if (s === 'loading') return <Skeleton lines={6} label="Loading Review Requests" />
  if (s === 'empty')
    return (
      <Stack gap="md">
        <EmptyState icon="check" title="Nothing to review" description="New Review Requests show up here and notify you." />
        <EndedSection />
      </Stack>
    )
  return null
}

function OfflineBanner() {
  return read(panelState) === 'offline' ? (
    <Callout tone="warning" icon="warning" title="Can't reach gitlab.com">
      <Text size="sm">
        Showing the list from <RelativeTime at={lastRefreshedAt} />. Retrying every 5 minutes.
      </Text>
    </Callout>
  ) : null
}

function EndedEntry(props: { e: EndedReviewRequest }) {
  const e = props.e
  return (
    <Stack gap="xs">
      <Text weight="medium" truncate>
        {e.title}
      </Text>
      <Row gap="xs" wrap>
        <Badge tone={e.reason === 'approved' || e.reason === 'merged' ? 'success' : 'neutral'}>{e.reason}</Badge>
        <Text muted size="xs">
          {shortProject(e.project)} !{String(e.iid)} · <RelativeTime at={e.endedAt} format="short" muted />
        </Text>
      </Row>
      {e.skipped ? (
        <Text size="xs" tone="warning">
          {e.skipped}
        </Text>
      ) : null}
      <Row>
        <Button size="xs" variant="outline" icon="delete" onPress={act(`Remove workspace ${e.workspace}`)}>
          Remove workspace
        </Button>
      </Row>
    </Stack>
  )
}

function EndedSection() {
  const list = visibleEnded()
  if (!list.length) return null
  return (
    <Collapsible title={`Ended (${list.length})`} description="Workspaces you can remove" defaultOpen={false}>
      <Stack gap="md">
        {list.map((e) => (
          <EndedEntry key={e.id} e={e} />
        ))}
      </Stack>
    </Collapsible>
  )
}

/** Primary action for a row: Start review (split) without a workspace, Open workspace with one. */
function PrimaryActions(props: { rr: ReviewRequest; size?: 'xs' | 'sm' }) {
  const rr = props.rr
  const size = props.size ?? 'xs'
  if (!rr.workspace)
    return (
      <Row gap="none">
        <Button size={size} tone="accent" icon="play" onPress={act(`Start review !${rr.iid}`)}>
          Start review
        </Button>
        <IconButton
          size={size}
          tone="accent"
          variant="outline"
          icon="agent"
          label="Start review with Agent Review"
          tooltip="Start review with Agent Review"
          onPress={act(`Start review + Agent Review !${rr.iid}`)}
        />
      </Row>
    )
  return (
    <Row gap="xs" wrap>
      <Button size={size} tone="accent" icon="folder" onPress={act(`Open workspace ${rr.workspace.name}`)}>
        Open workspace
      </Button>
      {rr.workspace.agentReview === 'none' ? (
        <Button size={size} variant="outline" icon="agent" onPress={act(`Run Agent Review !${rr.iid}`)}>
          Run Agent Review
        </Button>
      ) : null}
      {rr.workspace.preparedNotes ? (
        <Button size={size} variant="outline" icon="upload" onPress={act(`Post review !${rr.iid}`)}>
          Post {String(rr.workspace.preparedNotes)} to GitLab
        </Button>
      ) : null}
    </Row>
  )
}

function SecondaryIcons(props: { rr: ReviewRequest }) {
  const rr = props.rr
  return (
    <Row gap="none">
      <IconButton size="xs" variant="ghost" icon="open-external" label="Open in GitLab" onPress={act(`Open in browser !${rr.iid}`)} />
      <IconButton size="xs" variant="ghost" icon="copy" label="Copy link" onPress={act(`Copy link !${rr.iid}`)} />
      <IconButton size="xs" variant="ghost" icon="remove" label={`Mute ${rr.project}`} tooltip={`Mute ${rr.project}`} onPress={act(`Mute ${rr.project}`)} />
    </Row>
  )
}

// ---------- Variant A: inbox cards ----------
// Flat list, longest-waiting first. Every row carries its actions inline.
function VariantA() {
  const rrs = visibleRRs()
  return (
    <Stack gap="sm">
      {rrs.map((rr) => (
        <Box key={rr.id} border={rr.isNew ? 'accent' : true} radius="md" padding="sm" direction="column" gap="xs">
          <Row justify="between" align="start">
            <Text weight="semibold">{rr.title}</Text>
            {rr.isNew ? <Badge tone="accent">New</Badge> : null}
          </Row>
          <Text muted size="xs">
            {rr.project} !{String(rr.iid)} · {rr.author} · requested <RelativeTime at={rr.requestedAt} format="short" muted />
          </Text>
          <Row gap="xs" wrap>
            {pipelineBadge(rr.pipeline)}
            <Badge>{`${rr.approvals.given}/${rr.approvals.required} approvals`}</Badge>
            {rr.comments ? <Badge>{`${rr.comments} comments`}</Badge> : null}
          </Row>
          {agentText(rr) ? (
            <Text size="xs" tone={rr.workspace?.agentReview === 'done' ? 'success' : 'accent'}>
              {agentText(rr)}
            </Text>
          ) : null}
          <Row justify="between" align="center" wrap>
            <PrimaryActions rr={rr} />
            <SecondaryIcons rr={rr} />
          </Row>
        </Box>
      ))}
      <EndedSection />
    </Stack>
  )
}

// ---------- Variant B: table + detail ----------
// Dense, sortable table; the selected row's detail and actions sit below it.
function VariantB() {
  const rrs = visibleRRs()
  const sel = rrs.find((r) => r.id === read(selected)) ?? null
  return (
    <Stack gap="md">
      {/* Table isn't drawn by this Orca build (placeholder), so B uses a selectable List. */}
      <List label="Review Requests">
        {rrs.map((rr) => (
          <ListItem
            key={rr.id}
            icon={rr.workspace ? (rr.workspace.agentReview === 'done' ? 'check' : rr.workspace.agentReview === 'running' ? 'agent' : 'folder') : rr.isNew ? 'bell' : 'branch'}
            title={(rr.isNew ? '● ' : '') + rr.title}
            description={`${shortProject(rr.project)} !${rr.iid} · ${rr.author} · ${ageText(rr.requestedAt)}` + (rr.pipeline === 'failed' ? ' · CI failed' : '')}
            current={sel?.id === rr.id}
            onPress={() => set(selected, rr.id)}
          />
        ))}
      </List>
      {sel ? (
        <Card title={sel.title} description={`${sel.project} !${sel.iid}`}>
          <Stack gap="sm">
            <KeyValue
              items={[
                { label: 'Author', value: sel.author },
                { label: 'Pipeline', value: sel.pipeline },
                { label: 'Approvals', value: `${sel.approvals.given}/${sel.approvals.required}` },
                { label: 'Workspace', value: sel.workspace ? agentText(sel) ?? '' : 'none' }
              ]}
            />
            <PrimaryActions rr={sel} size="sm" />
            <SecondaryIcons rr={sel} />
          </Stack>
        </Card>
      ) : (
        <Text muted size="sm">Select a Review Request to see its actions.</Text>
      )}
      <EndedSection />
    </Stack>
  )
}

// ---------- Variant C: tabs by stage ----------
// "To review" (no workspace) / "In review" (has a workspace) / "Ended". Compact rows, grouped by project.
function CompactRow(props: { rr: ReviewRequest }) {
  const rr = props.rr
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Text weight="medium" truncate>
          {rr.isNew ? '● ' : ''}
          {rr.title}
        </Text>
        <Text muted size="xs">
          <RelativeTime at={rr.requestedAt} format="duration" muted />
        </Text>
      </Row>
      <Row justify="between" align="center" wrap>
        <Text muted size="xs">
          !{String(rr.iid)} · {rr.author}
          {agentText(rr) ? ` · ${agentText(rr)}` : ''}
        </Text>
        <Row gap="xs" align="center">
          {pipelineBadge(rr.pipeline)}
          <SecondaryIcons rr={rr} />
        </Row>
      </Row>
      <PrimaryActions rr={rr} />
    </Stack>
  )
}

function ByProject(props: { rrs: ReviewRequest[] }) {
  const groups = new Map<string, ReviewRequest[]>()
  for (const rr of props.rrs) groups.set(rr.project, [...(groups.get(rr.project) ?? []), rr])
  if (!groups.size) return <Text muted size="sm">Nothing here.</Text>
  return (
    <Stack gap="md">
      {[...groups.entries()].map(([project, list]) => (
        <Stack key={project} gap="sm">
          <Text size="xs" muted weight="semibold">
            {project}
          </Text>
          {list.map((rr, i) => (
            <Stack key={rr.id} gap="sm">
              {i > 0 ? <Separator /> : null}
              <CompactRow rr={rr} />
            </Stack>
          ))}
        </Stack>
      ))}
    </Stack>
  )
}

function VariantC() {
  const rrs = visibleRRs()
  const todo = rrs.filter((r) => !r.workspace)
  const inReview = rrs.filter((r) => r.workspace)
  const done = visibleEnded()
  return (
    <Tabs label="Stage" defaultValue="todo">
      <Tab value="todo" label={`To review ${todo.length}`}>
        <ByProject rrs={todo} />
      </Tab>
      <Tab value="in" label={`In review ${inReview.length}`}>
        <ByProject rrs={inReview} />
      </Tab>
      <Tab value="ended" label={`Ended ${done.length}`}>
        <Stack gap="md">
          {done.map((e) => (
            <EndedEntry key={e.id} e={e} />
          ))}
        </Stack>
      </Tab>
    </Tabs>
  )
}

// ---------- prototype bar ----------
function PrototypeBar() {
  const v = read(variant)
  const idx = VARIANTS.findIndex((x) => x.key === v)
  const cycle = (d: number) => () => set(variant, VARIANTS[(idx + d + VARIANTS.length) % VARIANTS.length].key)
  return (
    <Box border="warning" background="muted" radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="center">
        <IconButton icon="collapse" label="Previous variant" size="xs" onPress={cycle(-1)} />
        <Text size="xs" weight="semibold">
          PROTOTYPE · {v} ({VARIANTS[idx]?.name ?? '?'})
        </Text>
        <IconButton icon="expand" label="Next variant" size="xs" onPress={cycle(1)} />
      </Row>
      <Select
        label="Panel state"
        value={read(panelState)}
        options={[
          { value: 'loaded', label: 'State: loaded' },
          { value: 'refreshing', label: 'State: refreshing' },
          { value: 'empty', label: 'State: empty' },
          { value: 'loading', label: 'State: first load' },
          { value: 'offline', label: 'State: offline' },
          { value: 'setup', label: 'State: needs setup' }
        ]}
        onChange={(x) => {
          set(panelState, x as PanelState)
          void pushStatusBar()
        }}
      />
      <Select
        label="Status bar look"
        value={read(statusVariant)}
        options={[
          { value: 'icon-count', label: 'Status bar: icon + count (always)' },
          { value: 'label', label: 'Status bar: "5 reviews · 2 new"' },
          { value: 'quiet', label: 'Status bar: bell, hidden at 0' }
        ]}
        onChange={(x) => {
          set(statusVariant, x as StatusVariant)
          void pushStatusBar()
        }}
      />
      <Text size="xs" muted>
        Status bar now: {read(statusEcho) || '…'}
      </Text>
      <Text size="xs" muted>
        Last action: {read(lastAction)}
      </Text>
    </Box>
  )
}

export default function Panel() {
  const rrs = visibleRRs()
  const body = StateBody()
  const v = read(variant)
  return (
    <Stack gap="md">
      <Header count={rrs.length} />
      <OfflineBanner />
      {body ?? (v === 'A' ? <VariantA /> : v === 'B' ? <VariantB /> : <VariantC />)}
      <PrototypeBar />
    </Stack>
  )
}
