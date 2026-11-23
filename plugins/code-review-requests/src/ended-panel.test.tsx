// The panel's Ended tab (#28): Ended cards, Remove workspace, and the
// banner while the orca CLI is broken. The worker is stubbed through `requests`.
import { assert, hostError, mockHost, test } from 'orca/testing'
import { mount } from './testing/mount'
import * as panel from './panel'
import { headingCounts } from './testing/panel-heading'
import type { EndedCard, ReviewRequestsSnapshot } from './protocol'

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
  assert.equal(view.find({ type: 'Badge', text: 'Merged' })?.props.tone, 'success', 'with a status dot')
  assert.equal(view.find({ type: 'Badge', text: 'Removed as reviewer' })?.props.tone, 'neutral')
  assert.equal(view.find({ type: 'Button', text: 'Finish Review' }), null)
  assert.equal(view.findAll({ type: 'Button', text: 'Delete Workspace' }).length, 2)
  assert.deepEqual(headingCounts(view), [['0', 'dim']], 'Ended cards do not count as Review Requests')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Changes requested has the warning status dot, after Open workspace', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot({ ended: [ended(7, { reason: 'changes-requested' })] }) } })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  assert.equal(view.find({ type: 'Badge', text: 'Changes requested' })?.props.tone, 'warning')
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

test('Delete Workspace removes at once, without asking', async () => {
  const removed: { url: string }[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot({ ended: [ended(7)] }),
      'rr.removeWorkspace': (input) => {
        removed.push(input)
        return snapshot()
      }
    }
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  await view.press(view.find({ type: 'Button', text: 'Delete Workspace' })!)

  assert.deepEqual(removed, [{ url: ended(7).url }])
  assert.equal(view.find({ type: 'Button', text: 'Cancel' }), null, 'no confirmation')
  assert.ok(view.find({ type: 'Tab', label: 'Done' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("a failed removal shows Orca's error; Open workspace stays on the card", async () => {
  const opened: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot({ ended: [ended(7)] }),
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

  await view.press(view.find({ type: 'Button', text: 'Delete Workspace' })!)

  assert.ok(view.find({ text: /Couldn't remove the workspace: .*local-only ignored files/ }))
  await view.press(view.find({ type: 'IconButton', label: 'Open workspace' })!)
  assert.deepEqual(opened, [ended(7).url])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('while the orca CLI is broken, a banner says so and Delete Workspace is disabled', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot({ ended: [ended(7)], workspacesUnavailable: 'The orca CLI failed: Orca is not running' })
    }
  })
  const view = await mount(panel, { host, persisted: ON_ENDED })

  const banner = view.find({ type: 'Callout' })
  assert.equal(banner?.props.title, 'Orca CLI unavailable: workspace actions disabled')
  assert.ok(view.find({ text: 'The orca CLI failed: Orca is not running' }) === null, 'the reason sits under Details')
  assert.equal(view.find({ type: 'Button', text: 'Delete Workspace' })!.disabled, true)
  assert.equal(view.find({ type: 'IconButton', label: 'Open workspace' })!.disabled, true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
