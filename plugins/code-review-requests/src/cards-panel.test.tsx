// The card look of #10 (variant D): the New badge and accent border, the CI, approvals and
// comments badges, the Agent Review line and "Post N to GitLab" on In review cards. The worker
// is stubbed.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { PostPreview, ReviewDraftView, ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'

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

test('a New card has the New badge and an accent border; Overdue wins over New', async () => {
  const view = await mountWith({
    'rr.snapshot': snapshot(card(1, { isNew: true }), card(2, { isNew: true, overdue: true }), card(3))
  })

  const borders = view
    .findAll({ type: 'Box' })
    .filter((b) => b.props.radius === 'md')
    .map((b) => b.props.border)
  assert.deepEqual(borders.sort(), ['accent', 'danger', true].sort())
  assert.equal(view.findAll({ type: 'Badge', text: 'New' }).length, 1)
  assert.equal(view.findAll({ type: 'Badge', text: 'Overdue' }).length, 1)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

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

test('cards show CI, approvals and comment badges, and nothing for what is unknown', async () => {
  const view = await mountWith({
    'rr.snapshot': snapshot(
      card(1, { ci: 'failed', approvals: { given: 1, required: 2 }, comments: 3 }),
      card(2, { ci: 'passed', comments: 1 }),
      card(3, { ci: 'running', comments: 0, approvals: null })
    )
  })

  assert.equal(view.find({ type: 'Badge', text: 'CI failed' })?.props.tone, 'danger')
  assert.equal(view.find({ type: 'Badge', text: 'CI passed' })?.props.tone, 'success')
  assert.ok(view.find({ type: 'Badge', text: 'CI running' }))
  assert.ok(view.find({ type: 'Badge', text: '1/2 approvals' }))
  assert.ok(view.find({ type: 'Badge', text: '3 comments' }))
  assert.ok(view.find({ type: 'Badge', text: '1 comment' }))
  assert.equal(view.find({ type: 'Badge', text: '0 comments' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an In review card shows its Agent Review: running, or done with the comments ready', async () => {
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

  assert.ok(view.find({ text: 'Agent Review running' }))
  assert.ok(view.find({ text: 'Agent Review done · 4 comments ready' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('"Post N to GitLab" on an In review card opens the Review Draft at the post step', async () => {
  const url = card(7).url
  const draft: ReviewDraftView = { url, title: 'Merge request 7', workspace: WORKSPACE, comments: [], warnings: [], importedAt: NOW }
  const preview: PostPreview = { url, comments: 2, leftoverDrafts: [], warnings: [] }
  const previews: string[] = []
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(card(7, { workspace: WORKSPACE, toPost: 2, agentReview: null })),
      'rr.draft': draft,
      'rr.postPreview': ({ url: asked }: { url: string }) => {
        previews.push(asked)
        return preview
      }
    },
    { 'rr.tab': 'in' }
  )

  assert.equal(view.find({ type: 'Button', text: 'Post 0 to GitLab' }), null)
  await view.press(view.find({ type: 'Button', text: 'Post 2 to GitLab' })!)

  assert.deepEqual(previews, [url])
  assert.ok(view.find({ type: 'Heading', text: 'Review Draft' }))
  assert.ok(view.find({ type: 'Heading', text: 'Post review' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an In review card with nothing to post has no Post button', async () => {
  const view = await mountWith(
    { 'rr.snapshot': snapshot(card(7, { workspace: WORKSPACE, toPost: 0 })) },
    { 'rr.tab': 'in' }
  )

  assert.equal(view.find({ type: 'Button', text: /^Post \d+ to GitLab$/ }), null)
  await view.unmount()
})

test('an In review card whose merge request moved on shows "Merge request updated" and Update workspace', async () => {
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

  assert.equal(view.findAll({ type: 'Badge', text: 'Merge request updated' }).length, 1)
  assert.equal(view.findAll({ type: 'Button', text: 'Update workspace' }).length, 1)
  await view.press(view.find({ type: 'Button', text: 'Update workspace' })!)

  assert.deepEqual(updates, [url])
  assert.equal(view.find({ type: 'Badge', text: 'Merge request updated' }), null)
  assert.equal(view.find({ type: 'Button', text: 'Update workspace' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a refused Update workspace shows why on the card and keeps the notice', async () => {
  const view = await mountWith(
    {
      'rr.snapshot': snapshot(card(7, { workspace: WORKSPACE, mergeRequestUpdated: true })),
      'rr.updateWorkspace': () => {
        throw new Error('The Review Workspace review-api-7 has 1 uncommitted change: commit or stash them first. Nothing was changed.')
      }
    },
    { 'rr.tab': 'in' }
  )

  await view.press(view.find({ type: 'Button', text: 'Update workspace' })!)

  assert.ok(view.find({ text: /^Couldn't update the workspace: .*commit or stash them first/ }))
  assert.ok(view.find({ type: 'Badge', text: 'Merge request updated' }))
  await view.unmount()
})
