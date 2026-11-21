import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { shortTitle, TITLE_MAX } from './short-title'
import type { ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'
import { headingCounts, headingLook } from './testing/panel-heading'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 16, 9, 0)

function card(iid: number, extra: Partial<ReviewRequestCard> = {}): ReviewRequestCard {
  return {
    url: `https://gitlab.example.com/acme/api/-/merge_requests/${iid}`,
    title: `Merge request ${iid}`,
    projectPath: 'acme/api',
    iid,
    author: 'ada',
    requestedAt: NOW - iid * HOUR,
    overdue: false,
    ...extra
  }
}

function snapshot(...reviewRequests: ReviewRequestCard[]): ReviewRequestsSnapshot {
  return { reviewRequests, refreshedAt: NOW }
}

test('shows that there is nothing to review when the worker has no Review Requests', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: null } } })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Heading', text: 'Review Requests' }))
  assert.ok(view.find({ type: 'EmptyState' }))
  assert.ok(view.find({ text: 'No open review requests' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('says so, without throwing, when the worker cannot answer', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': () => {
        throw hostError('unavailable', 'worker not running')
      }
    }
  })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Callout' }))
  assert.ok(view.find({ text: /worker not running/ }))
  assert.equal(view.find({ type: 'EmptyState' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('has To review, In review and Ended tabs with their counts, To review first', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(2), card(1)) } })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Tab', label: 'Todo · 2' }))
  assert.ok(view.find({ type: 'Tab', label: 'Reviewing' }))
  assert.ok(view.find({ type: 'Tab', label: 'Done' }))
  assert.equal(view.valueOf(view.find({ type: 'Tabs' })!), 'todo')
  assert.deepEqual(headingCounts(view), [['2', 'dim']])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('draws a card per Review Request in the order the worker gives, longest waiting first', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(card(7, { title: 'Add login', author: 'ada' }), card(3, { title: 'Fix typo' })) }
  })
  const view = await mount(panel, { host })

  const tree = JSON.stringify(view.tree())
  assert.ok(tree.indexOf('Add login') < tree.indexOf('Fix typo'))
  assert.ok(view.find({ type: 'Button', text: '7' }))
  assert.ok(view.find({ type: 'Text', text: 'by ada' }))
  assert.ok(view.find({ text: /^\d+[mhd]$/ }), 'the card shows its age')
  assert.equal(view.find({ type: 'Badge', text: 'Late' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an overdue card gets a Late badge; the tabs carry no icon', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(50, { overdue: true }), card(1)) } })
  const view = await mount(panel, { host })

  assert.equal(view.findAll({ type: 'Badge', text: 'Late' }).length, 1)
  assert.equal(view.findAll({ type: 'Box' }).filter((box) => box.props.radius === 'md' && box.props.border === 'danger').length, 0, 'the Late badge is enough: no red border')
  const ages = view.findAll({ type: 'Text', text: /^\d+[mhd]$/ }).map((age) => age.props.tone)
  assert.deepEqual(ages, [undefined, undefined], 'the Late badge is enough: no red age')
  assert.ok(view.find({ type: 'Tab', label: 'Todo · 1 | 1!' }))
  assert.equal(view.findAll({ type: 'Tab' }).some((tab) => tab.props.icon !== undefined), false)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

const overdue = (iid: number) => card(iid, { overdue: true })

test('the heading splits the count into a dimmed in-time and a strong overdue count, on a red-outlined pill', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(overdue(52), overdue(51), overdue(50), card(2), card(1)) }
  })
  const view = await mount(panel, { host })

  assert.deepEqual(headingCounts(view), [
    ['2', 'dim'],
    ['3', 'strong']
  ])
  assert.deepEqual(headingLook(view), { background: 'danger', border: 'danger' })
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the heading shows only the overdue count, on a red-outlined pill, when every Review Request is overdue', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(overdue(51), overdue(50)) } })
  const view = await mount(panel, { host })

  assert.deepEqual(headingCounts(view), [['2', 'strong']])
  assert.deepEqual(headingLook(view), { background: 'danger', border: 'danger' })
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the heading shows only the in-time count when no Review Request is overdue', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(3), card(2), card(1)) } })
  const view = await mount(panel, { host })

  assert.deepEqual(headingCounts(view), [['3', 'dim']])
  assert.deepEqual(headingLook(view), { background: 'muted', border: false })
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the heading shows a single dimmed 0 when there are no Review Requests', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot() } })
  const view = await mount(panel, { host })

  assert.deepEqual(headingCounts(view), [['0', 'dim']])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the other tabs show the same empty state as Todo', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(1)) } })
  const view = await mount(panel, { host })

  await view.select(view.find({ type: 'Tabs' })!, 'in')
  assert.ok(view.find({ type: 'EmptyState', text: 'No reviews in progress' }))
  await view.select(view.find({ type: 'Tabs' })!, 'ended')
  assert.ok(view.find({ type: 'EmptyState', text: 'No completed reviews' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("the card's title starts with the MR id, a button with the URL as tooltip that opens it in the browser", async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(7)) } })
  const view = await mount(panel, { host })

  const link = view.find({ type: 'Button', text: '7' })
  assert.ok(link)
  assert.equal(link!.props.tooltip, card(7).url)
  assert.equal(link!.props.icon, undefined)
  assert.equal(view.find({ text: /acme\/api/ }), null, 'the project path is only in the tooltip')
  await view.press(link!)

  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: card(7).url }])
  assert.equal(view.find({ type: 'IconButton', label: 'Open in GitLab' }), null)
  assert.equal(view.find({ type: 'IconButton', label: 'Copy link' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('the last refresh time never shows seconds: "just now", then whole minutes', async () => {
  const now = Date.now()
  const fresh = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: now - 20_000 } } })
  })
  assert.ok(fresh.find({ text: 'just now' }))
  assert.equal(fresh.find({ type: 'RelativeTime' }), null)
  await fresh.unmount()

  const older = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: now - 5 * 60_000 - 20_000 } } })
  })
  assert.ok(older.find({ text: '5m ago' }))
  await older.unmount()
})

test('the refresh button asks the worker to poll and shows the new list', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(), 'rr.refresh': snapshot(card(1, { title: 'Fresh' })) }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'No open review requests' }))

  const refreshButton = view.findAll({ type: 'Button' }).find((b) => b.props.tooltip === 'Refresh')
  assert.equal(refreshButton?.props.icon, 'refresh')
  assert.equal(refreshButton?.props.variant, 'ghost')
  await view.press(refreshButton!)

  assert.ok(view.find({ text: 'Fresh' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('before the first refresh, Refresh is just its icon, with no label', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': { reviewRequests: [], refreshedAt: null } } })
  })

  assert.ok(view.find({ type: 'IconButton', label: 'Refresh' }))
  assert.equal(view.find({ text: 'Refresh' }), null)
  await view.unmount()
})

const WORKSPACE = { id: 'repo::/wt/review-api-1', name: 'review-api-1', path: '/wt/review-api-1' }

test('a Review Request with a Review Workspace is under In review, not To review', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(card(1, { title: 'Reviewing', workspace: WORKSPACE }), card(2, { title: 'Waiting', workspace: null })) }
  })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Tab', label: 'Todo · 1' }))
  assert.ok(view.find({ type: 'Tab', label: 'Reviewing · 1' }))
  assert.ok(view.find({ text: 'Waiting' }))
  assert.equal(view.find({ text: 'Reviewing' }), null)

  await view.select(view.find({ type: 'Tabs' })!, 'in')
  assert.ok(view.find({ text: 'Reviewing' }))
  assert.ok(view.find({ type: 'IconButton', label: 'Open workspace' }))
  assert.ok(view.find({ type: 'IconButton', label: 'Run Agent Review' }))
  assert.equal(view.find({ type: 'Button', text: 'Start Review' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('without a Review Prompt, Start review asks for a workspace without an agent, and the card moves to Reviewing', async () => {
  const asked: { url: string; withAgent: boolean }[] = []
  const host = mockHost({
    settings: { reviewPrompt: '' },
    requests: {
      'rr.snapshot': snapshot(card(1, { workspace: null })),
      'rr.startReview': (input) => {
        asked.push(input)
        return snapshot(card(1, { workspace: WORKSPACE }))
      }
    }
  })
  const view = await mount(panel, { host })

  await view.press(view.find({ type: 'Button', text: 'Start Review' })!)

  assert.deepEqual(asked, [{ url: card(1).url, withAgent: false }])
  assert.ok(view.find({ type: 'Tab', label: 'Reviewing · 1' }))
  assert.ok(view.find({ type: 'Tab', label: 'Todo' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Todo and Reviewing count like the status bar: in time | overdue!, just "N!" when all are late; Done counts plainly', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': {
        ...snapshot(
          card(1, { overdue: true }),
          card(2),
          card(3),
          card(4, { overdue: true, workspace: WORKSPACE })
        ),
        ended: [
          { ...card(5), reason: 'merged', endedAt: NOW, workspace: { ...WORKSPACE, id: 'repo::/wt/5' }, autoRemoveSkipped: null }
        ]
      }
    }
  })
  const view = await mount(panel, { host })

  assert.deepEqual(
    view.findAll({ type: 'Tab' }).map((tab) => tab.props.label),
    ['Todo · 2 | 1!', 'Reviewing · 1!', 'Done · 1']
  )
  await view.unmount()
})

test('after Start review, the Reviewing tab opens with the new card on top', async () => {
  const other = { ...WORKSPACE, id: 'repo::/wt/review-api-2', path: '/wt/review-api-2' }
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot(card(2, { workspace: other }), card(1, { workspace: null })),
      // The worker keeps its order (longest waiting first): the started card comes second.
      'rr.startReview': () => snapshot(card(2, { workspace: other }), card(1, { workspace: WORKSPACE }))
    }
  })
  const view = await mount(panel, { host, persisted: { plugin: { 'rr.tab': 'todo' } } })

  await view.press(view.find({ type: 'Button', text: 'Start Review' })!)

  assert.equal(view.valueOf(view.find({ type: 'Tabs' })!), 'in')
  const titles = view.findAll({ text: /^Merge request \d$/ }).map((t) => t.text)
  assert.deepEqual(titles, ['Merge request 1', 'Merge request 2'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('with a Review Prompt, Start review always starts an Agent Review; there is no separate agent button', async () => {
  const asked: { url: string; withAgent: boolean }[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot(card(1, { workspace: null })),
      'rr.startReview': (input) => {
        asked.push(input)
        return snapshot(card(1, { workspace: WORKSPACE }))
      }
    }
  })
  const view = await mount(panel, { host })

  assert.equal(view.find({ type: 'IconButton', label: 'Start review with Agent Review' }), null)
  await view.press(view.find({ type: 'Button', text: 'Start Review' })!)

  assert.deepEqual(asked, [{ url: card(1).url, withAgent: true }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Start review is disabled with the hint when it cannot run', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(card(1, { workspace: null, startBlocked: 'Add acme/api to Orca to review here.' })) }
  })
  const view = await mount(panel, { host })

  assert.equal(view.find({ type: 'Button', text: 'Start Review' })!.disabled, true)
  assert.ok(view.find({ text: 'Add acme/api to Orca to review here.' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says on the card why Start review failed', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot(card(1, { workspace: null })),
      'rr.startReview': () => {
        throw hostError('action_failed', 'git fetch of the MR failed')
      }
    }
  })
  const view = await mount(panel, { host })

  await view.press(view.find({ type: 'Button', text: 'Start Review' })!)

  assert.ok(view.find({ text: /Couldn't create the Review Workspace: .*git fetch of the MR failed/ }))
  assert.equal(view.find({ type: 'Button', text: 'Start Review' })!.disabled, false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Open workspace and Run Agent Review go to the worker; navigation sits in its own row above Review draft', async () => {
  const opened: string[] = []
  const reviewed: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot(card(1, { workspace: WORKSPACE })),
      'rr.openWorkspace': ({ url }) => {
        opened.push(url)
        return { opened: true }
      },
      'rr.runAgentReview': ({ url }) => {
        reviewed.push(url)
        return { started: true }
      }
    }
  })
  const view = await mount(panel, { host, persisted: { plugin: { 'rr.tab': 'in' } } })

  // The navigation icon buttons have their own row, above the actions; that row starts with
  // Review draft.
  const rowOf = (node: { path: string }) => node.path.slice(0, node.path.lastIndexOf('/'))
  const pressables = view.findAll({ type: 'Button' }).concat(view.findAll({ type: 'IconButton' }))
  const inRow = (row: string) =>
    pressables
      .filter((b) => rowOf(b) === row)
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  const open = view.find({ type: 'IconButton', label: 'Open workspace' })!
  assert.deepEqual(
    inRow(rowOf(open)).map((b) => b.props.label),
    ['Open workspace', 'View changes', 'View MR summary']
  )
  const draft = view.find({ type: 'Button', text: 'Review Draft' })!
  assert.equal(inRow(rowOf(draft))[0]?.text, 'Review Draft')
  assert.ok(open.path.localeCompare(draft.path, undefined, { numeric: true }) < 0, 'navigation comes first')
  await view.press(view.find({ type: 'IconButton', label: 'Open workspace' })!)
  await view.press(view.find({ type: 'IconButton', label: 'Run Agent Review' })!)

  assert.deepEqual(opened, [card(1).url])
  assert.deepEqual(reviewed, [card(1).url])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("an In review card's icon buttons show the changed files and open the merge request summary", async () => {
  const changes: string[] = []
  const covers: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot(card(1, { workspace: WORKSPACE })),
      'rr.showChanges': ({ url }) => {
        changes.push(url)
        return { opened: true }
      },
      'rr.openCoverPage': ({ url }) => {
        covers.push(url)
        return { opened: true }
      }
    }
  })
  const view = await mount(panel, { host, persisted: { plugin: { 'rr.tab': 'in' } } })

  await view.press(view.find({ type: 'IconButton', label: 'View changes' })!)
  await view.press(view.find({ type: 'IconButton', label: 'View MR summary' })!)

  assert.deepEqual(changes, [card(1).url])
  assert.deepEqual(covers, [card(1).url])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('updates when the worker pushes a new snapshot', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot() } })
  const view = await mount(panel, { host })

  await view.post('rr.changed', snapshot(card(1, { title: 'Pushed' })))

  assert.ok(view.find({ text: 'Pushed' }))
  assert.ok(view.find({ type: 'Tab', label: 'Todo · 1' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('without a Review Prompt, a Reviewing card has no Run Agent Review button', async () => {
  const host = mockHost({
    settings: { reviewPrompt: '' },
    requests: { 'rr.snapshot': snapshot(card(1, { workspace: WORKSPACE })) }
  })
  const view = await mount(panel, { host, persisted: { plugin: { 'rr.tab': 'in' } } })

  assert.ok(view.find({ type: 'IconButton', label: 'Open workspace' }))
  assert.equal(view.find({ type: 'IconButton', label: 'Run Agent Review' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a long title is cut at a word to about two lines, with an ellipsis', () => {
  assert.equal(shortTitle('Fix typo'), 'Fix typo')
  const long = 'INT2-2509: Warn when an imported contract number is already used by another contract in the same tenant'
  const short = shortTitle(long)
  assert.ok(short.length <= TITLE_MAX)
  assert.ok(short.endsWith('…'))
  assert.ok(long.startsWith(short.slice(0, -1)), 'cut at a word, nothing reworded')
  assert.equal(shortTitle('x'.repeat(100)), `${'x'.repeat(TITLE_MAX - 1)}…`, 'one long word is cut mid-word')
})
