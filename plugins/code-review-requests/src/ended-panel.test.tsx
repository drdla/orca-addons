// The panel's Ended tab (#28): Ended cards, Remove workspace with its confirmation, and the
// banner while the orca CLI is broken. The worker is stubbed through `requests`.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { headingCounts } from './testing/panel-heading'
import type { EndedCard, RemovalCheck, ReviewRequestsSnapshot } from './protocol'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 16, 9, 0)
const ON_ENDED = { plugin: { 'rr.tab': 'ended' } }

function ended(iid: number, extra: Partial<EndedCard> = {}): EndedCard {
  return {
    url: `https://gitlab.example.com/acme/api/-/merge_requests/${iid}`,
    title: `Merge request ${iid}`,
    projectPath: 'acme/api',
    iid,
    author: 'ada',
    requestedAt: NOW - 30 * HOUR,
    reason: 'merged',
    endedAt: NOW - HOUR,
    workspace: { id: `repo::/wt/review-api-${iid}`, name: `review-api-${iid}`, path: `/wt/review-api-${iid}` },
    autoRemoveSkipped: null,
    ...extra
  }
}

function snapshot(extra: Partial<ReviewRequestsSnapshot> = {}): ReviewRequestsSnapshot {
  return { reviewRequests: [], refreshedAt: NOW, ...extra }
}

test('the Ended tab counts and draws Ended Review Requests with their reason', async () => {
  const host = mockHost({
    requests: { 'rr.snapshot': snapshot({ ended: [ended(7), ended(9, { reason: 'unassigned' })] }) }
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  assert.ok(view.find({ type: 'Tab', label: 'Done · 2' }))
  assert.ok(view.find({ text: 'Merge request 7' }))
  assert.equal(view.find({ type: 'Badge', text: 'Merged' })?.props.tone, 'neutral', 'a toned Badge draws a dot')
  assert.ok(view.find({ type: 'Badge', text: 'Removed as reviewer' }))
  assert.equal(view.find({ type: 'Button', text: 'Review Draft' }), null)
  assert.equal(view.findAll({ type: 'Button', text: 'Remove Workspace' }).length, 2)
  assert.deepEqual(headingCounts(view), [['0', 'dim']], 'Ended cards do not count as Review Requests')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("an Ended card's MR reference opens it in the browser; under the title, only its author", async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot({ ended: [ended(7)] }) } })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  assert.ok(view.find({ text: 'by ada' }))
  assert.equal(view.find({ text: /ended/ }), null, 'no time since it ended')
  assert.equal(view.find({ text: /review-api-7/ }), null, 'no workspace name')
  assert.equal(view.find({ type: 'IconButton', label: 'Open in GitLab' }), null)
  await view.press(view.find({ type: 'Button', text: '7' })!)
  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: ended(7).url }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a card says why auto-removal skipped it', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot({
        ended: [ended(7, { autoRemoveSkipped: 'Not removed automatically: 1 uncommitted change.' })]
      })
    }
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  assert.ok(view.find({ text: 'Not removed automatically: 1 uncommitted change.' }))
  await view.unmount()
})

function removalHost(check: RemovalCheck, remove: (input: { url: string; force: boolean }) => ReviewRequestsSnapshot) {
  return mockHost({
    requests: {
      'rr.snapshot': snapshot({ ended: [ended(7)] }),
      'rr.checkRemoval': () => check,
      'rr.removeWorkspace': remove
    }
  })
}

test('Remove workspace confirms first, then removes without force when clean', async () => {
  const removed: { url: string; force: boolean }[] = []
  const host = removalHost({ problems: [], force: false }, (input) => {
    removed.push(input)
    return snapshot()
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  await view.press(view.find({ type: 'Button', text: 'Remove Workspace' })!)
  assert.deepEqual(removed, [], 'nothing removed before confirming')
  assert.ok(view.find({ text: /Remove review-api-7\?/ }))

  await view.press(view.find({ type: 'Button', text: 'Remove' })!)

  assert.deepEqual(removed, [{ url: ended(7).url, force: false }])
  assert.ok(view.find({ type: 'Tab', label: 'Done' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('with something to lose, the confirmation lists it and offers Remove anyway (forced)', async () => {
  const removed: { url: string; force: boolean }[] = []
  const host = removalHost({ problems: ['2 uncommitted changes', 'an agent is running'], force: true }, (input) => {
    removed.push(input)
    return snapshot()
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  await view.press(view.find({ type: 'Button', text: 'Remove Workspace' })!)
  assert.ok(view.find({ text: /2 uncommitted changes/ }))
  assert.ok(view.find({ text: /an agent is running/ }))
  assert.equal(view.find({ type: 'Button', text: 'Remove' }), null)

  await view.press(view.find({ type: 'Button', text: 'Remove anyway' })!)

  assert.deepEqual(removed, [{ url: ended(7).url, force: true }])
  await view.unmount()
})

test('Cancel closes the confirmation without removing', async () => {
  const removed: unknown[] = []
  const host = removalHost({ problems: [], force: false }, (input) => {
    removed.push(input)
    return snapshot()
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  await view.press(view.find({ type: 'Button', text: 'Remove Workspace' })!)
  await view.press(view.find({ type: 'Button', text: 'Cancel' })!)

  assert.deepEqual(removed, [])
  assert.equal(view.find({ type: 'Button', text: 'Remove' }), null)
  assert.ok(view.find({ type: 'Button', text: 'Remove Workspace' }))
  await view.unmount()
})

test("a failed removal shows Orca's error; Open workspace stays on the card", async () => {
  const opened: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot({ ended: [ended(7)] }),
      'rr.checkRemoval': { problems: [], force: false },
      'rr.removeWorkspace': () => {
        throw hostError('action_failed', 'worktree has local-only ignored files: .env')
      },
      'rr.openWorkspace': ({ url }) => {
        opened.push(url)
        return { opened: true }
      }
    }
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  await view.press(view.find({ type: 'Button', text: 'Remove Workspace' })!)
  await view.press(view.find({ type: 'Button', text: 'Remove' })!)

  assert.ok(view.find({ text: /Couldn't remove the workspace: .*local-only ignored files/ }))
  await view.press(view.find({ type: 'IconButton', label: 'Open workspace' })!)
  assert.deepEqual(opened, [ended(7).url])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('while the orca CLI is broken, a banner says so and Remove workspace is disabled', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot({ ended: [ended(7)], workspacesUnavailable: 'The orca CLI failed: Orca is not running' })
    }
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  const banner = view.find({ type: 'Callout' })
  assert.equal(banner?.props.title, 'Orca CLI unavailable: workspace actions disabled')
  assert.ok(view.find({ text: 'The orca CLI failed: Orca is not running' }) === null, 'the reason sits under Details')
  assert.equal(view.find({ type: 'Button', text: 'Remove Workspace' })!.disabled, true)
  assert.equal(view.find({ type: 'IconButton', label: 'Open workspace' })!.disabled, true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
