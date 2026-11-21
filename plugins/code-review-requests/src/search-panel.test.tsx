// The search above the tabs: it narrows all three tabs and their counts, a pasted merge request
// link opens the one other tab that has its card, and an empty tab says nothing matches.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { EndedCard, ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'

const NOW = Date.UTC(2026, 10, 16, 9, 0)
const WORKSPACE = { id: 'repo::/wt/review', name: 'review', path: '/wt/review' }

function url(iid: number): string {
  return `https://gitlab.example.com/acme/api/-/merge_requests/${iid}`
}

function card(iid: number, title: string, extra: Partial<ReviewRequestCard> = {}): ReviewRequestCard {
  return { url: url(iid), title, projectPath: 'acme/api', iid, author: 'ada', requestedAt: NOW, overdue: false, ...extra }
}

function ended(iid: number, title: string): EndedCard {
  return {
    ...card(iid, title),
    reason: 'merged',
    endedAt: NOW,
    workspace: { ...WORKSPACE, id: `repo::/wt/review-${iid}` },
    autoRemoveSkipped: null
  }
}

const SNAPSHOT: ReviewRequestsSnapshot = {
  reviewRequests: [
    card(11, 'DNI-1645: One timeframe row'),
    card(12, 'Fix login redirect'),
    card(3021, 'DNI-1700: Invoice export', { workspace: WORKSPACE })
  ],
  ended: [ended(40, 'Bump dependencies')],
  refreshedAt: NOW
}

async function mountPanel(persisted: Record<string, unknown> = {}) {
  const host = mockHost({ requests: { 'rr.snapshot': SNAPSHOT, 'rr.markSeen': { seen: true } } as never })
  return mount(panel, { host, persisted: { plugin: persisted } })
}

function searchInput(view: Awaited<ReturnType<typeof mountPanel>>) {
  const input = view.find({ type: 'Input', label: 'Search Review Requests' })
  assert.ok(input, 'the search input')
  return input
}

function emptyTitle(view: Awaited<ReturnType<typeof mountPanel>>): unknown {
  return view.find({ type: 'EmptyState' })?.props.title
}

function tabLabels(view: Awaited<ReturnType<typeof mountPanel>>): string[] {
  return view.findAll({ type: 'Tab' }).map((tab) => String(tab.props.label))
}

test('the search sits above the tabs and narrows every tab and its count', async () => {
  const view = await mountPanel()
  assert.equal(searchInput(view).props.placeholder, 'Search title or URL')
  assert.deepEqual(tabLabels(view), ['Todo · 2', 'Reviewing · 1', 'Done · 1'])

  await view.type(searchInput(view), 'dni-')
  assert.deepEqual(tabLabels(view), ['Todo · 1', 'Reviewing · 1', 'Done'])
  assert.ok(view.find({ text: 'DNI-1645: One timeframe row' }))
  assert.equal(view.find({ text: 'Fix login redirect' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a pasted link to a card on another tab opens that tab', async () => {
  const view = await mountPanel({ 'rr.tab': 'todo' })

  await view.type(searchInput(view), `${url(3021)}/diffs#note_7`)
  assert.equal(view.valueOf(view.find({ type: 'Tabs' })!), 'in')
  assert.ok(view.find({ text: 'DNI-1700: Invoice export' }))
  assert.deepEqual(tabLabels(view), ['Todo', 'Reviewing · 1', 'Done'])
  await view.unmount()
})

test('a tab without a match says so, worded per tab', async () => {
  const view = await mountPanel({ 'rr.tab': 'todo' })

  await view.type(searchInput(view), 'nothing like this')
  assert.equal(emptyTitle(view), 'No open review requests matching "nothing like this"')
  await view.select({ type: 'Tabs' }, 'in')
  assert.equal(emptyTitle(view), 'No reviews in progress matching "nothing like this"')
  await view.select({ type: 'Tabs' }, 'ended')
  assert.equal(emptyTitle(view), 'No completed reviews matching "nothing like this"')
  await view.unmount()
})

test('clearing the search shows every card again', async () => {
  const view = await mountPanel()

  await view.type(searchInput(view), 'login')
  assert.deepEqual(tabLabels(view), ['Todo · 1', 'Reviewing', 'Done'])
  await view.type(searchInput(view), '', { replace: true })
  assert.deepEqual(tabLabels(view), ['Todo · 2', 'Reviewing · 1', 'Done · 1'])
  await view.unmount()
})
