// The Review Draft drill-in view (#29): opened from an In review card, it lists the diff-view
// notes (read-only) and Agent Findings (editable) with a checkbox each. The worker is stubbed.
import { assert, hostError, mockHost, test } from 'orca/testing'
import { mount } from './testing/mount'
import * as panel from './panel'
import { VISIBILITY_CHECK_MS } from './review-draft-view'
import type { ReviewCommentView, ReviewDraftView, ReviewRequestCard, ReviewRequestsSnapshot } from './protocol'

const NOW = Date.UTC(2026, 10, 16, 9, 0)
const URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const WORKSPACE = { id: 'repo-api::/wt/review-api-7', name: 'review-api-7', path: '/wt/review-api-7' }

const inReview: ReviewRequestCard = {
  url: URL,
  title: 'Add login',
  projectPath: 'acme/api',
  iid: 7,
  author: 'ada',
  requestedAt: NOW - 3_600_000,
  overdue: false,
  workspace: WORKSPACE,
  startBlocked: null
}
const snapshot: ReviewRequestsSnapshot = { reviewRequests: [inReview], refreshedAt: NOW }

function comment(id: string, extra: Partial<ReviewCommentView> = {}): ReviewCommentView {
  const finding = id.startsWith('finding:')
  return {
    id,
    origin: finding ? 'agent-finding' : 'diff-note',
    filePath: 'src/login.ts',
    line: 10,
    body: `body of ${id}`,
    checked: !finding,
    editable: finding,
    sha: 'sha-head',
    posted: false,
    ...extra
  }
}

function draft(comments: ReviewCommentView[], extra: Partial<ReviewDraftView> = {}): ReviewDraftView {
  return { url: URL, title: 'Add login', workspace: WORKSPACE, comments, warnings: [], importedAt: NOW, ...extra }
}

const persisted = { plugin: { 'rr.tab': 'in' } }

type View = Awaited<ReturnType<typeof mount>>

/** A comment's checkbox, found by its location: the checkbox's description. */
function boxAt(view: View, location: string) {
  return view.findAll({ type: 'Checkbox' }).find((box) => box.props.description === location) ?? null
}

async function openDraft(requests: Record<string, unknown>) {
  const host = mockHost({ requests: { 'rr.snapshot': snapshot, ...requests } })
  const view = await mount(panel, { host, persisted })
  await view.press(view.find({ type: 'Button', text: 'Finish Review' })!)
  return { host, view }
}

test('an In review card opens its Review Draft; Back returns to the tabs', async () => {
  const asked: unknown[] = []
  const { view } = await openDraft({
    'rr.draft': (input: unknown) => {
      asked.push(input)
      return draft([
        comment('note:n1', { startLine: 8, body: 'Why not reuse the helper?' }),
        comment('finding:a', { filePath: null, line: null, body: 'Split this MR.' })
      ])
    }
  })

  assert.deepEqual(asked, [{ url: URL }])
  assert.ok(view.find({ type: 'Heading', text: 'Finish Review' }))
  assert.ok(view.find({ text: 'Add login' }))
  // A note's body is its checkbox's label, the location its description; a finding's label names it.
  assert.equal(boxAt(view, 'src/login.ts:8–10')?.label, 'Why not reuse the helper?')
  assert.equal(boxAt(view, 'General comment')?.label, 'Agent Finding')
  assert.equal(view.valueOf(view.find({ type: 'Textarea', label: 'Agent Finding' })!), 'Split this MR.')
  assert.equal(view.find({ text: /checked/ }), null, 'no "N of M checked" line')
  assert.equal(view.find({ type: 'Tabs' }), null)

  await view.press(view.find({ type: 'Button', text: '← Back' })!)
  assert.ok(view.find({ type: 'Tabs' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('checking a finding asks the worker and shows its answer', async () => {
  const updates: unknown[] = []
  const { view } = await openDraft({
    'rr.draft': draft([comment('finding:a')]),
    'rr.updateDraftComment': (input: { id: string; checked?: boolean }) => {
      updates.push(input)
      return draft([comment('finding:a', { checked: input.checked ?? false })])
    }
  })

  const box = boxAt(view, 'src/login.ts:10')!
  assert.equal(view.valueOf(box), false)
  await view.toggle(box)

  assert.deepEqual(updates, [{ url: URL, id: 'finding:a', checked: true }])
  assert.equal(view.valueOf(boxAt(view, 'src/login.ts:10')!), true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an edited finding is saved with Save; diff-view notes have no editor', async () => {
  const updates: unknown[] = []
  const { view } = await openDraft({
    'rr.draft': draft([comment('note:n1'), comment('finding:a', { body: 'old' })]),
    'rr.updateDraftComment': (input: { body?: string }) => {
      updates.push(input)
      return draft([comment('note:n1'), comment('finding:a', { body: input.body ?? 'old' })])
    }
  })

  assert.equal(view.findAll({ type: 'Textarea', label: 'Agent Finding' }).length, 1)
  assert.ok(view.find({ type: 'IconButton', label: 'Edit or delete in the diff view' }))
  assert.equal(view.find({ type: 'Button', text: 'Save' }), null, 'no Save until something changed')
  await view.type(view.find({ type: 'Textarea', label: 'Agent Finding' })!, 'new text', { replace: true })
  await view.press(view.find({ type: 'Button', text: 'Save' })!)

  assert.deepEqual(updates, [{ url: URL, id: 'finding:a', body: 'new text' }])
  assert.equal(view.valueOf(view.find({ type: 'Textarea', label: 'Agent Finding' })!), 'new text')
  assert.equal(view.find({ type: 'Button', text: 'Save' }), null)
  await view.unmount()
})

test('a refused change shows on the comment', async () => {
  const { view } = await openDraft({
    'rr.draft': draft([comment('finding:a')]),
    'rr.updateDraftComment': () => {
      throw hostError('invalid_params', 'That Review Comment is already posted to GitLab.')
    }
  })
  await view.toggle(boxAt(view, 'src/login.ts:10')!)
  assert.ok(view.find({ text: /already posted to GitLab/ }))
  await view.unmount()
})

test('comments that may be outdated and stale Agent Findings are marked, and stay curatable (#58)', async () => {
  const { view } = await openDraft({
    'rr.draft': draft([
      comment('note:n1', { outdated: true, sha: 'sha-old' }),
      comment('note:n2', { line: 40 }),
      comment('finding:a', { line: 12, stale: true, sha: 'sha-old' }),
      comment('finding:b', { line: 30, stale: true, outdated: true, sha: 'sha-old' })
    ]),
    'rr.updateDraftComment': draft([comment('note:n1', { outdated: true, checked: false })])
  })

  assert.equal(view.findAll({ type: 'Badge', text: 'May be outdated' }).length, 2)
  assert.equal(view.findAll({ type: 'Badge', text: 'Stale' }).length, 2)
  const callout = view.find({ type: 'Callout', label: 'The Review Workspace has moved on' })
  assert.ok(callout)
  assert.ok(view.find({ text: /2 Review Comments may be outdated: their lines changed since they were written/ }))
  assert.ok(view.find({ text: /2 Agent Findings are from an older commit: run Agent Review for fresh ones, then import again/ }))
  // Still editable and checkable.
  assert.equal(view.findAll({ type: 'Textarea', label: 'Agent Finding' }).length, 2)
  assert.notEqual(boxAt(view, 'src/login.ts:10')!.disabled, true)
  await view.toggle(boxAt(view, 'src/login.ts:10')!)
  assert.equal(view.valueOf(boxAt(view, 'src/login.ts:10')!), false)
  assert.ok(view.find({ type: 'Badge', text: 'May be outdated' }), 'the flag stays after the change')
  await view.unmount()
})

test('posted comments are marked and locked; warnings and empty sections are explained', async () => {
  const { view } = await openDraft({
    'rr.draft': draft([comment('note:n1', { posted: true })], {
      warnings: ['Agent Finding 3 skipped: no body.']
    })
  })

  assert.ok(view.find({ type: 'Badge', text: 'Posted' }))
  assert.equal(boxAt(view, 'src/login.ts:10')!.disabled, true)
  assert.ok(view.find({ type: 'Callout', label: 'Some things were not imported' }))
  assert.ok(view.find({ text: 'Agent Finding 3 skipped: no body.' }))
  assert.ok(view.find({ type: 'EmptyState', text: 'No Agent Findings' }))
  await view.unmount()
})

test('says so when the Review Draft cannot be loaded, and Try Again retries', async () => {
  let calls = 0
  const { view } = await openDraft({
    'rr.draft': () => {
      calls += 1
      if (calls === 1) throw hostError('unavailable', 'worker stopped')
      return draft([])
    }
  })
  assert.ok(view.find({ text: /worker stopped/ }))

  await view.press(view.find({ type: 'Button', text: 'Try Again' })!)
  assert.equal(calls, 2)
  assert.ok(view.find({ type: 'EmptyState', text: 'No Review Comments' }))
  await view.unmount()
})

test('the header has only Back and the title: no Cover page or Import again', async () => {
  const { view } = await openDraft({ 'rr.draft': draft([]) })
  assert.equal(view.find({ type: 'Button', text: 'Cover page' }), null)
  assert.equal(view.find({ type: 'IconButton', label: 'Import again' }), null)
  await view.unmount()
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('an open Review Draft imports again when the panel comes back into view, not while hidden', async () => {
  let calls = 0
  const { view } = await openDraft({
    'rr.draft': () => {
      calls += 1
      return draft(calls === 1 ? [] : [comment('note:n1', { body: 'Added in the diff view.' })])
    }
  })
  assert.equal(calls, 1)

  await view.setVisible(false)
  await wait(VISIBILITY_CHECK_MS * 1.5)
  assert.equal(calls, 1, 'no import while hidden')

  await view.setVisible(true)
  await wait(VISIBILITY_CHECK_MS * 1.5)
  await view.settled()
  assert.equal(calls, 2)
  assert.ok(view.find({ type: 'Checkbox', label: 'Added in the diff view.' }))
  await view.unmount()
})

test('a diff-view note opens the diff view to edit or delete it; an Agent Finding is deleted', async () => {
  const asked: string[] = []
  const deletes: unknown[] = []
  const { view } = await openDraft({
    'rr.draft': draft([comment('note:n1'), comment('finding:a')]),
    'rr.showChanges': () => {
      asked.push('showChanges')
      return { opened: true }
    },
    'rr.deleteDraftComment': (input: unknown) => {
      deletes.push(input)
      return draft([comment('note:n1')])
    }
  })

  await view.press(view.find({ type: 'IconButton', label: 'Edit or delete in the diff view' })!)
  assert.deepEqual(asked, ['showChanges'])
  await view.press(view.find({ type: 'IconButton', label: 'Delete Agent Finding' })!)
  assert.deepEqual(deletes, [{ url: URL, id: 'finding:a' }])
  assert.equal(view.find({ type: 'Textarea', label: 'Agent Finding' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the section headings go to the diff view and run an Agent Review', async () => {
  const asked: string[] = []
  const { view } = await openDraft({
    'rr.draft': draft([]),
    'rr.showChanges': () => {
      asked.push('showChanges')
      return { opened: true }
    },
    'rr.runAgentReview': () => {
      asked.push('runAgentReview')
      return { started: true }
    }
  })

  await view.press(view.find({ type: 'Button', text: 'Open Diff View' })!)
  await view.press(view.find({ type: 'IconButton', label: 'Run Agent Review' })!)
  assert.deepEqual(asked, ['showChanges', 'runAgentReview'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a long file path loses its middle and keeps its end', async () => {
  const filePath = 'apps/admin/src/modules/universalFilters/components/filters/TimeframeFilter.tsx'
  const { view } = await openDraft({ 'rr.draft': draft([comment('note:n1', { filePath })]) })

  const location = `${filePath.slice(0, 45)}…${filePath.slice(-14)}:10`
  assert.ok(boxAt(view, location), location)
  await view.unmount()
})
