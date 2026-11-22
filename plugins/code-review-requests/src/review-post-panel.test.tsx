// Posting from the Review Draft view (#30): the outcome and summary form, the warnings GitLab gives
// before posting, posting, partial failure, success and the missing api scope. The worker is stubbed.
import { assert, hostError, mockHost, test } from 'orca/testing'
import { mount } from './testing/mount'
import * as panel from './panel'
import type {
  ConnectionView,
  PostPreview,
  PostResult,
  ReviewCommentView,
  ReviewDraftView,
  ReviewRequestCard,
  ReviewRequestsSnapshot
} from './protocol'

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
  return {
    id,
    origin: 'diff-note',
    filePath: 'src/login.ts',
    line: 10,
    body: `body of ${id}`,
    checked: true,
    editable: false,
    sha: 'sha-head',
    posted: false,
    ...extra
  }
}

function draft(comments: ReviewCommentView[]): ReviewDraftView {
  return { url: URL, title: 'Add login', workspace: WORKSPACE, comments, warnings: [], importedAt: NOW }
}

function connection(canPost: boolean | null): ConnectionView {
  return {
    configured: true,
    host: 'gitlab.example.com',
    source: canPost === false ? 'token' : 'glab',
    user: 'me',
    scopes: canPost === false ? ['read_api'] : null,
    canList: true,
    canPost,
    tokenStorage: 'os-keyring',
    problem: null
  }
}

/** A post GitLab has nothing to warn about: Post Review posts straight away. */
const clean: PostPreview = { url: URL, comments: 2, leftoverDrafts: [], warnings: [] }

/** A post with a warning and one of my GitLab drafts that would publish too. */
const preview: PostPreview = {
  url: URL,
  comments: 2,
  leftoverDrafts: [{ id: 41, body: 'Started in the browser' }],
  warnings: ['The MR has new commits since 2 Review Comments were written: GitLab may show them as outdated.']
}

const persisted = { plugin: { 'rr.tab': 'in', 'rr.draftUrl': URL } }

async function openDraft(requests: Record<string, unknown>, canPost: boolean | null = null, comments = [comment('note:n1'), comment('note:n2')]) {
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot,
      'rr.connection': connection(canPost),
      'rr.draft': draft(comments),
      'rr.postPreview': clean,
      ...requests
    }
  })
  const view = await mount(panel, { host, persisted })
  return { host, view }
}

const postReview = { type: 'Button', text: 'Post Review' } as const

function posted(sent: unknown[]) {
  return (input: unknown): PostResult => {
    sent.push(input)
    return {
      posted: 2,
      failed: [],
      approveError: null,
      draft: draft([comment('note:n1', { posted: true }), comment('note:n2', { posted: true })])
    }
  }
}

test('the page has the outcome, the summary and Post Review', async () => {
  const { view } = await openDraft({})

  assert.equal(view.valueOf(view.find({ type: 'RadioGroup', label: 'Outcome' })!), 'requested_changes')
  assert.ok(view.find({ type: 'Textarea', label: 'Summary' }))
  assert.equal(view.find(postReview)!.disabled, false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Post Review sends the summary and outcome, then shows the review posted', async () => {
  const sent: unknown[] = []
  const { view } = await openDraft({ 'rr.postReview': posted(sent) })
  await view.type(view.find({ type: 'Textarea', label: 'Summary' })!, 'Nearly there.')
  await view.select(view.find({ type: 'RadioGroup', label: 'Outcome' })!, 'requested_changes')

  await view.press(view.find(postReview)!)

  assert.deepEqual(sent, [{ url: URL, summary: 'Nearly there.', outcome: 'requested_changes' }])
  assert.ok(view.find({ type: 'Callout', label: 'Review posted' }))
  assert.ok(view.find({ text: /2 Review Comments posted/ }))
  assert.ok(view.find({ text: /clear the posted notes in Orca's diff view/i }))
  assert.equal(view.findAll({ type: 'Badge', text: 'Posted' }).length, 2)
  assert.equal(view.valueOf(view.find({ type: 'Textarea', label: 'Summary' })!), '')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the outcome follows the checked comments until I pick one: Approve with none, Request changes with some', async () => {
  const sent: unknown[] = []
  const { view } = await openDraft(
    {
      'rr.postReview': posted(sent),
      'rr.updateDraftComment': (input: { checked?: boolean }) => draft([comment('note:n1', { checked: input.checked ?? false })])
    },
    null,
    [comment('note:n1', { checked: false })]
  )
  const radios = () => view.find({ type: 'RadioGroup', label: 'Outcome' })!
  assert.equal(view.valueOf(radios()), 'approve')

  await view.toggle(view.find({ type: 'Checkbox' })!)
  assert.equal(view.valueOf(radios()), 'requested_changes')
  await view.select(radios(), 'comment')
  await view.toggle(view.find({ type: 'Checkbox' })!)
  assert.equal(view.valueOf(radios()), 'comment', 'a picked outcome stays')
  assert.equal(view.find(postReview)!.disabled, true, 'nothing to post: no comments, no summary, Comment')

  await view.select(radios(), 'approve')
  await view.press(view.find(postReview)!)
  assert.deepEqual(sent, [{ url: URL, summary: '', outcome: 'approve' }])
  await view.unmount()
})

test('warnings and my other GitLab drafts show before posting: Post Anyway or Cancel', async () => {
  const sent: unknown[] = []
  const { view } = await openDraft({ 'rr.postPreview': preview, 'rr.postReview': posted(sent) })

  await view.press(view.find(postReview)!)

  assert.deepEqual(sent, [])
  assert.ok(view.find({ type: 'Callout', label: 'Your other GitLab drafts on this MR publish too' }))
  assert.ok(view.find({ text: 'Started in the browser' }))
  assert.ok(view.find({ text: /new commits since 2 Review Comments/ }))
  await view.press(view.find({ type: 'Button', text: 'Cancel' })!)
  assert.equal(view.find({ text: 'Started in the browser' }), null)

  await view.press(view.find(postReview)!)
  await view.press(view.find({ type: 'Button', text: 'Post Anyway' })!)
  assert.equal(sent.length, 1)
  assert.ok(view.find({ type: 'Callout', label: 'Review posted' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a partial failure lists what did not post, with Retry and Delete failed drafts', async () => {
  const deleted: unknown[] = []
  const { view } = await openDraft({
    'rr.postReview': (): PostResult => ({
      posted: 1,
      failed: [{ commentId: 'note:n2', location: 'src/login.ts:10', message: 'GitLab kept it as a draft: it did not publish.' }],
      approveError: 'SHA does not match HEAD of source branch',
      draft: draft([
        comment('note:n1', { posted: true }),
        comment('note:n2', { failure: 'GitLab kept it as a draft: it did not publish.' })
      ])
    }),
    'rr.deleteFailedDrafts': (input: unknown) => {
      deleted.push(input)
      return draft([comment('note:n1', { posted: true }), comment('note:n2')])
    }
  })
  await view.press(view.find(postReview)!)

  assert.ok(view.find({ type: 'Callout', label: "1 Review Comment couldn't be posted" }))
  assert.ok(view.find({ text: 'src/login.ts:10: GitLab kept it as a draft: it did not publish.' }))
  assert.ok(view.find({ type: 'Callout', label: 'Not approved' }))
  assert.ok(view.find({ text: /Not posted: GitLab kept it as a draft/ }))

  await view.press(view.find({ type: 'Button', text: 'Delete failed drafts' })!)
  assert.deepEqual(deleted, [{ url: URL }])
  assert.equal(view.find({ text: /Not posted:/ }), null)
  assert.ok(view.find(postReview))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Retry after a partial failure posts again', async () => {
  let calls = 0
  const { view } = await openDraft({
    'rr.postReview': (): PostResult => {
      calls += 1
      return {
        posted: 0,
        failed: [{ commentId: 'note:n2', location: 'src/login.ts:10', message: 'kept as a draft' }],
        approveError: null,
        draft: draft([comment('note:n1'), comment('note:n2', { failure: 'kept as a draft' })])
      }
    }
  })
  await view.press(view.find(postReview)!)

  await view.press(view.find({ type: 'Button', text: 'Retry' })!)

  assert.equal(calls, 2)
  await view.unmount()
})

test('a refused post says why and keeps the summary', async () => {
  const { view } = await openDraft({
    'rr.postReview': () => {
      throw hostError('internal', 'Posting a review needs a token with the api scope. GitLab said: 403 insufficient_scope')
    }
  })
  await view.type(view.find({ type: 'Textarea', label: 'Summary' })!, 'Nearly there.')
  await view.press(view.find(postReview)!)

  assert.ok(view.find({ type: 'Callout', label: "Couldn't post the Review Draft" }))
  assert.ok(view.find({ text: /needs a token with the api scope/ }))
  assert.equal(view.valueOf(view.find({ type: 'Textarea', label: 'Summary' })!), 'Nearly there.')
  await view.unmount()
})

test('without the api scope, Post Review is disabled with the hint', async () => {
  const { view } = await openDraft({}, false)

  assert.equal(view.find(postReview)!.disabled, true)
  assert.ok(view.find({ text: 'Posting a review needs a token with the api scope.' }))
  await view.unmount()
})

test('the warnings and summary survive a panel reload; a post whose answer was lost goes back to Post Review', async () => {
  const confirm = { kind: 'confirm', preview, postingSince: null }
  const reopened = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': snapshot, 'rr.draft': draft([comment('note:n1')]) } }),
    persisted: { plugin: { ...persisted.plugin, 'rr.postStep': confirm, 'rr.postSummary': 'Half written' } }
  })
  assert.ok(reopened.find({ type: 'Button', text: 'Post Anyway' }))
  assert.equal(reopened.valueOf(reopened.find({ type: 'Textarea', label: 'Summary' })!), 'Half written')
  await reopened.unmount()

  const stale = { kind: 'confirm', preview, postingSince: Date.now() - 10 * 60_000 }
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': snapshot, 'rr.draft': draft([comment('note:n1')]) } }),
    persisted: { plugin: { ...persisted.plugin, 'rr.postStep': stale } }
  })
  assert.equal(view.find({ type: 'Button', text: 'Post Anyway' }), null)
  assert.ok(view.find(postReview))
  await view.unmount()
})

test('while posting, the form is locked', async () => {
  // The kit's press waits for the request, so the in-flight state is seeded (as after a reload).
  const posting = { kind: 'confirm', preview, postingSince: Date.now() }
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': snapshot, 'rr.draft': draft([comment('note:n1')]) } }),
    persisted: { plugin: { ...persisted.plugin, 'rr.postStep': posting } }
  })

  assert.equal(view.find(postReview)!.disabled, true)
  assert.equal(view.find({ type: 'Textarea', label: 'Summary' })!.disabled, true)
  assert.equal(view.find({ type: 'Button', text: 'Cancel' }), null)
  assert.ok(view.find({ type: 'Spinner', label: 'Posting' }))
  await view.unmount()
})
