import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'

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
  assert.ok(view.find({ text: 'Nothing to review' }))
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

  assert.ok(view.find({ type: 'Tab', label: 'To review 2' }))
  assert.ok(view.find({ type: 'Tab', label: 'In review 0' }))
  assert.ok(view.find({ type: 'Tab', label: 'Ended 0' }))
  assert.equal(view.valueOf(view.find({ type: 'Tabs' })!), 'todo')
  assert.ok(view.find({ type: 'Badge', text: '2' }))
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
  assert.ok(view.find({ text: /acme\/api !7 · ada · requested/ }))
  assert.equal(view.find({ type: 'Badge', text: 'Overdue' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an overdue card gets an Overdue badge and the To review tab a warning icon', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(50, { overdue: true }), card(1)) } })
  const view = await mount(panel, { host })

  assert.equal(view.findAll({ type: 'Badge', text: 'Overdue' }).length, 1)
  assert.ok(view.find({ type: 'Tab', label: 'To review 2' }))
  assert.match(JSON.stringify(view.tree()), /"icon":"warning"/)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('the other tabs say there is nothing there yet', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(1)) } })
  const view = await mount(panel, { host })

  await view.select(view.find({ type: 'Tabs' })!, 'in')
  assert.ok(view.find({ text: 'Nothing here.' }))
  await view.select(view.find({ type: 'Tabs' })!, 'ended')
  assert.ok(view.find({ text: 'Nothing here.' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('opens a Review Request in the browser', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot(card(7)) } })
  const view = await mount(panel, { host })

  await view.press(view.find({ type: 'IconButton', label: 'Open in GitLab' })!)

  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: card(7).url }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('copies a Review Request link through the worker', async () => {
  const copied: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot(card(7)),
      'rr.copyLink': ({ url }) => {
        copied.push(url)
        return { copied: true }
      }
    }
  })
  const view = await mount(panel, { host })

  await view.press(view.find({ type: 'IconButton', label: 'Copy link' })!)

  assert.deepEqual(copied, [card(7).url])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('says so on the card when the link could not be copied', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot(card(7)),
      'rr.copyLink': () => {
        throw hostError('action_failed', 'pbcopy missing')
      }
    }
  })
  const view = await mount(panel, { host })

  await view.press(view.find({ type: 'IconButton', label: 'Copy link' })!)

  assert.ok(view.find({ text: /Couldn't copy the link/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the refresh button asks the worker to poll and shows the new list', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(), 'rr.refresh': snapshot(card(1, { title: 'Fresh' })) }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Nothing to review' }))

  await view.press(view.find({ type: 'IconButton', label: 'Refresh' })!)

  assert.ok(view.find({ text: 'Fresh' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

const WORKSPACE = { id: 'repo::/wt/review-api-1', name: 'review-api-1', path: '/wt/review-api-1' }

test('a Review Request with a Review Workspace is under In review, not To review', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(card(1, { title: 'Reviewing', workspace: WORKSPACE }), card(2, { title: 'Waiting', workspace: null })) }
  })
  const view = await mount(panel, { host })

  assert.ok(view.find({ type: 'Tab', label: 'To review 1' }))
  assert.ok(view.find({ type: 'Tab', label: 'In review 1' }))
  assert.ok(view.find({ text: 'Waiting' }))
  assert.equal(view.find({ text: 'Reviewing' }), null)

  await view.select(view.find({ type: 'Tabs' })!, 'in')
  assert.ok(view.find({ text: 'Reviewing' }))
  assert.ok(view.find({ type: 'Button', text: 'Open workspace' }))
  assert.ok(view.find({ type: 'IconButton', label: 'Run Agent Review' }))
  assert.equal(view.find({ type: 'Button', text: 'Start review' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Start review asks the worker for a workspace without an agent, and the card moves to In review', async () => {
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

  await view.press(view.find({ type: 'Button', text: 'Start review' })!)

  assert.deepEqual(asked, [{ url: card(1).url, withAgent: false }])
  assert.ok(view.find({ type: 'Tab', label: 'In review 1' }))
  assert.ok(view.find({ type: 'Tab', label: 'To review 0' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the agent button starts the review with an Agent Review', async () => {
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

  await view.press(view.find({ type: 'IconButton', label: 'Start review with Agent Review' })!)

  assert.deepEqual(asked, [{ url: card(1).url, withAgent: true }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Start review is disabled with the hint when it cannot run', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot(card(1, { workspace: null, startBlocked: 'Add acme/api to Orca to review here.' })) }
  })
  const view = await mount(panel, { host })

  assert.equal(view.find({ type: 'Button', text: 'Start review' })!.disabled, true)
  assert.equal(view.find({ type: 'IconButton', label: 'Start review with Agent Review' })!.disabled, true)
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

  await view.press(view.find({ type: 'Button', text: 'Start review' })!)

  assert.ok(view.find({ text: /Couldn't create the Review Workspace: .*git fetch of the MR failed/ }))
  assert.equal(view.find({ type: 'Button', text: 'Start review' })!.disabled, false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Open workspace and Run Agent Review go to the worker', async () => {
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

  await view.press(view.find({ type: 'Button', text: 'Open workspace' })!)
  await view.press(view.find({ type: 'IconButton', label: 'Run Agent Review' })!)

  assert.deepEqual(opened, [card(1).url])
  assert.deepEqual(reviewed, [card(1).url])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('updates when the worker pushes a new snapshot', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot() } })
  const view = await mount(panel, { host })

  await view.post('rr.changed', snapshot(card(1, { title: 'Pushed' })))

  assert.ok(view.find({ text: 'Pushed' }))
  assert.ok(view.find({ type: 'Tab', label: 'To review 1' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
