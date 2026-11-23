// The card look of #10 (variant D): the New badge, what holds the merge
// request up (CI, open comments) after the buttons, approvals, the Agent Review line and
// the Review Draft button on In review cards. The worker is stubbed.
import { assert, mockHost, test } from 'orca/testing'
import { mount } from './testing/mount'
import * as panel from './panel'
import type { ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 16, 9, 0)
const WORKSPACE = { id: 'repo-api::/wt/review-api-7', name: 'review-api-7', path: '/wt/review-api-7' }

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

async function mountWith(requests: Record<string, unknown>, persisted?: Record<string, unknown>) {
  const host = mockHost({ requests: { 'rr.markSeen': { seen: true }, ...requests } as never })
  return mount(panel, { host, ...(persisted ? { persisted: { plugin: persisted } } : {}) })
}

test('opening the panel tells the worker its Review Requests are seen', async () => {
  let marked = 0
  const view = await mountWith({
    'rr.snapshot': snapshot(card(1)),
    'rr.markSeen': () => {
      marked++
      return { seen: true }
    }
  })

  assert.equal(marked, 1)
  await view.unmount()
})

test('a card held up by CI or open comments shows the reasons mid-dot separated after its buttons, with no label', async () => {
  const view = await mountWith({
    'rr.snapshot': snapshot(
      card(1, { ci: 'failed', approvals: { given: 1, required: 2 }, comments: 3 }),
      card(2, { ci: 'passed', comments: 1 }),
      card(3, { ci: 'running', comments: 0, approvals: null }),
      card(4, { ci: 'passed', comments: 0 })
    )
  })

  assert.equal(view.find({ text: /mergeable|Blocked/ }), null, 'no label in front of the reasons')
  const tree = JSON.stringify(view.tree())
  assert.ok(tree.indexOf('Start Review') < tree.indexOf('CI failed'), 'the reasons follow the button')
  assert.ok(view.find({ type: 'Link', text: 'CI failed' }))
  assert.ok(view.find({ type: 'Link', text: 'CI running' }))
  assert.equal(view.find({ text: /CI passed/ }), null, 'a passed pipeline holds nothing up')
  assert.ok(view.find({ type: 'Link', text: '3 open comments' }))
  assert.ok(view.find({ type: 'Link', text: '1 open comment' }))
  assert.equal(view.find({ text: '0 open comments' }), null)
  assert.equal(view.findAll({ type: 'Text', text: '·' }).length, 1, 'only card 1 has two reasons')
  assert.equal(view.find({ type: 'Badge', text: /CI|open comment/ }), null, 'the reasons are links, not badges')
  assert.ok(view.find({ type: 'Badge', text: '1/2 approvals' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("the reasons open in the browser: CI on the MR's pipelines, open comments on the MR", async () => {
  const host = mockHost({
    requests: { 'rr.markSeen': { seen: true }, 'rr.snapshot': snapshot(card(1, { ci: 'failed', comments: 2 })) } as never,
    results: { 'shell.openExternal': { opened: true } }
  })
  const view = await mount(panel, { host })
  const url = snapshot(card(1)).reviewRequests[0]!.url

  await view.press(view.find({ type: 'Link', text: 'CI failed' })!)
  await view.press(view.find({ type: 'Link', text: '2 open comments' })!)

  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: `${url}/pipelines` }, { url }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a running Agent Review replaces the agent button with a spinner; a done one shows no line', async () => {
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(
        card(7, { workspace: WORKSPACE, agentReview: { state: 'running', commentsReady: 0 } }),
        card(8, {
          workspace: { ...WORKSPACE, id: 'w8' },
          agentReview: { state: 'done', commentsReady: 4 },
          toPost: 0
        })
      )
    },
    { 'rr.tab': 'in' }
  )

  assert.equal(view.findAll({ type: 'Spinner', label: 'Agent Review in progress' }).length, 1, 'only the running one')
  assert.equal(view.find({ text: /Agent Review (running|done)/ }), null, 'no text line')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an In review card shows a badge when the user already commented', async () => {
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(
        card(7, { workspace: WORKSPACE, myReview: 'commented' }),
        card(9, { workspace: { ...WORKSPACE, id: 'w9' }, myReview: null })
      )
    },
    { 'rr.tab': 'in' }
  )

  assert.equal(view.find({ type: 'Badge', text: 'Commented' })?.props.tone, 'accent')
  assert.equal(view.findAll({ type: 'Badge', text: 'Commented' }).length, 1, 'nothing on a card not yet reviewed')
  assert.equal(view.find({ type: 'IconButton', label: /^You / }), null, 'a badge, not a button')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an In review card has no Post button: posting is on its Review Draft', async () => {
  const view = await mountWith(
    { 'rr.snapshot': snapshot(card(7, { workspace: WORKSPACE, toPost: 2 })) },
    { 'rr.tab': 'in' }
  )

  assert.equal(view.find({ type: 'Button', text: /^Post \d+ to GitLab$/ }), null)
  await view.unmount()
})

test('an In review card whose merge request moved on offers Pull Changes first, Finish Review disabled until pulled, no badge', async () => {
  const url = card(7).url
  const other = card(8, { workspace: { ...WORKSPACE, id: 'w8' } })
  const updates: string[] = []
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(card(7, { workspace: WORKSPACE, mergeRequestUpdated: true }), other),
      'rr.updateWorkspace': ({ url: asked }: { url: string }) => {
        updates.push(asked)
        return snapshot(card(7, { workspace: WORKSPACE, mergeRequestUpdated: false }), other)
      }
    },
    { 'rr.tab': 'in' }
  )

  assert.equal(view.find({ type: 'Badge', text: 'Merge request updated' }), null)
  assert.equal(view.findAll({ type: 'Button', text: 'Pull Changes' }).length, 1)
  const finish = () => view.findAll({ type: 'Button', text: 'Finish Review' }).map((b) => b.disabled === true)
  assert.deepEqual(finish(), [true, false], 'disabled on the card behind, enabled on the other')
  const buttons = view.findAll({ type: 'Button' }).map((b) => b.text)
  assert.ok(buttons.indexOf('Pull Changes') < buttons.indexOf('Finish Review'), 'Pull Changes comes first')
  await view.press(view.find({ type: 'Button', text: 'Pull Changes' })!)

  assert.deepEqual(updates, [url])
  assert.equal(view.find({ type: 'Button', text: 'Pull Changes' }), null)
  assert.deepEqual(finish(), [false, false], 'enabled once pulled')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a refused Update workspace shows why on the card and keeps the button', async () => {
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(card(7, { workspace: WORKSPACE, mergeRequestUpdated: true })),
      'rr.updateWorkspace': () => {
        throw new Error('The Review Workspace review-api-7 has 1 uncommitted change: commit or stash them first. Nothing was changed.')
      }
    },
    { 'rr.tab': 'in' }
  )

  await view.press(view.find({ type: 'Button', text: 'Pull Changes' })!)

  assert.ok(view.find({ text: /^Couldn't update the workspace: .*commit or stash them first/ }))
  assert.ok(view.find({ type: 'Button', text: 'Pull Changes' }))
  await view.unmount()
})

test('a Reviewing card offers Remove workspace at the end of its navigation row, and removes at once (#80)', async () => {
  const removed: { url: string }[] = []
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(card(7, { workspace: WORKSPACE })),
      'rr.removeWorkspace': (input: { url: string }) => {
        removed.push(input)
        return snapshot(card(7))
      }
    },
    { 'rr.tab': 'in' }
  )

  await view.press(view.find({ type: 'IconButton', label: 'Delete workspace' })!)

  assert.deepEqual(removed, [{ url: card(7).url }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a Todo card without a workspace has no Remove workspace', async () => {
  const view = await mountWith({ 'rr.snapshot': snapshot(card(7)) }, { 'rr.tab': 'todo' })

  assert.equal(view.find({ type: 'IconButton', label: 'Delete workspace' }), null)
  await view.unmount()
})

test('a re-requested card is under Todo, even with its old workspace: Re-requested, what the user did before, Start Review and Remove workspace (#79)', async () => {
  const started: unknown[] = []
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(
        card(7, { workspace: WORKSPACE, reRequested: 'approved', isNew: true }),
        card(8, { reRequested: 'changes-requested' }),
        card(9, { workspace: { ...WORKSPACE, id: 'w9' } })
      ),
      'rr.startReview': (input: unknown) => {
        started.push(input)
        return snapshot(card(7, { workspace: WORKSPACE }))
      }
    },
    { 'rr.tab': 'todo' }
  )

  assert.ok(view.find({ type: 'Tab', label: /^Todo · 2/ }), 'both re-requested cards count under Todo')
  assert.ok(view.find({ type: 'Tab', label: /^Reviewing · 1/ }))
  assert.equal(view.findAll({ type: 'Badge', text: 'Re-requested' }).length, 2)
  assert.equal(view.find({ type: 'Badge', text: 'New' }), null, 'Re-requested instead of New')
  assert.equal(view.find({ type: 'Badge', text: 'You approved' })?.props.tone, 'success')
  assert.equal(view.find({ type: 'Badge', text: 'You requested changes' })?.props.tone, 'warning')
  assert.equal(view.findAll({ type: 'Button', text: 'Start Review' }).length, 2)
  assert.equal(view.findAll({ type: 'IconButton', label: 'Delete workspace' }).length, 1, 'only on the one with a workspace')
  assert.equal(view.find({ type: 'Button', text: 'Finish Review' }), null)
  assert.equal(view.find({ type: 'IconButton', label: 'View changes' }), null, 'no Reviewing navigation row')

  await view.press(view.findAll({ type: 'Button', text: 'Start Review' })[0]!)
  assert.deepEqual(started, [{ url: card(7).url, withAgent: true }], 'with the default Review Prompt')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
