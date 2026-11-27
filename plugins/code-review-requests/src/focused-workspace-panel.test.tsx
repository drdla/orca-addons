// The card of the review the user is in is highlighted (accent border and tint): Orca's
// workspace.changed names the focused workspace, the worker answers its path, and the card whose
// Review Workspace has that path stands out. The panel tests stub the worker; the last test
// drives the real one.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps } from './fakes'
import { mount } from './testing/mount'
import { CONFIGURED, startWorker } from './testing/worker-harness'
import * as panel from './panel'
import type { EndedCard, ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 16, 9, 0)

function workspace(iid: number) {
  return { id: `repo-api::/wt/review-api-${iid}`, name: `review-api-${iid}`, path: `/wt/review-api-${iid}` }
}

function card(iid: number, extra: Partial<ReviewRequestCard> = {}): ReviewRequestCard {
  return {
    url: `https://gitlab.example.com/acme/api/-/merge_requests/${iid}`,
    title: `Merge request ${iid}`,
    projectPath: 'acme/api',
    iid,
    author: 'ada',
    requestedAt: NOW - iid * HOUR,
    overdue: false,
    workspace: workspace(iid),
    ...extra
  }
}

function ended(iid: number): EndedCard {
  return {
    ...card(iid),
    reason: 'merged',
    endedAt: NOW - HOUR,
    workspace: workspace(iid),
    autoRemoveSkipped: null
  }
}

function snapshot(extra: Partial<ReviewRequestsSnapshot> = {}): ReviewRequestsSnapshot {
  return { reviewRequests: [card(7), card(8)], refreshedAt: NOW, ...extra }
}

/** The host ids Orca would name in workspace.changed, by path. */
const HOST_IDS: Record<string, string> = { 'ws-7': '/wt/review-api-7', 'ws-8': '/wt/review-api-8', 'ws-9': '/wt/review-api-9' }

async function mountOn(tab: string, snap = snapshot()) {
  const host = mockHost({
    requests: {
      'rr.markSeen': { seen: true },
      'rr.snapshot': snap,
      'rr.workspacePath': ({ workspaceId }: { workspaceId: string }) => ({ path: HOST_IDS[workspaceId] ?? null })
    } as never
  })
  return mount(panel, { host, persisted: { plugin: { 'rr.tab': tab } } })
}

type View = Awaited<ReturnType<typeof mountOn>>

type Node = { type?: string; key?: string | number; props?: Record<string, unknown>; children?: unknown[] }

/** The cards' frames, top to bottom: 'accent' for a highlighted card, 'plain' otherwise. */
function frames(view: View): string[] {
  const found: string[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const { type, key, props, children } = node as Node
    // A card is the Box keyed by its merge request URL.
    if (type === 'Box' && typeof key === 'string' && key.includes('/merge_requests/')) {
      found.push(props?.border === 'accent' && props.background === 'accent' ? 'accent' : 'plain')
    }
    children?.forEach(walk)
  }
  walk(view.tree())
  return found
}

function focus(view: View, workspaceId: string | null) {
  return view.emit('workspace.changed', {
    context:
      workspaceId === null ? null : { workspaceId, branch: 'review', displayName: workspaceId, terminals: [] }
  })
}

test("the card of the focused Review Workspace is highlighted, and follows the focus", async () => {
  const view = await mountOn('in')
  assert.deepEqual(frames(view), ['plain', 'plain'], 'nothing focused yet')

  await focus(view, 'ws-7')
  assert.deepEqual(frames(view), ['accent', 'plain'], 'cards 7, then 8')

  await focus(view, 'ws-8')
  assert.deepEqual(frames(view), ['plain', 'accent'])

  await focus(view, null)
  assert.deepEqual(frames(view), ['plain', 'plain'], 'no workspace focused')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a workspace that is no Review Workspace highlights nothing', async () => {
  const view = await mountOn('in')

  await focus(view, 'ws-elsewhere')
  assert.deepEqual(frames(view), ['plain', 'plain'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("a Done card is highlighted while the user is in its workspace", async () => {
  const view = await mountOn('ended', snapshot({ reviewRequests: [], ended: [ended(9)] }))

  await focus(view, 'ws-9')
  assert.deepEqual(frames(view), ['accent'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("the worker answers a focused workspace's path from Orca's workspace list, null for one it doesn't list", async () => {
  const host = mockHost({
    settings: CONFIGURED,
    results: {
      'workspace.list': {
        workspaces: [{ id: 'ws-7', kind: 'worktree' as const, name: 'review-api-7', path: '/wt/review-api-7', branch: null, hostId: 'local' }],
        truncated: false
      }
    }
  })
  const { worker } = await startWorker(fakeDeps(), CONFIGURED, host)

  assert.deepEqual(await worker.request('rr.workspacePath', { workspaceId: 'ws-7' }), { path: '/wt/review-api-7' })
  assert.deepEqual(await worker.request('rr.workspacePath', { workspaceId: 'ws-gone' }), { path: null })
})
