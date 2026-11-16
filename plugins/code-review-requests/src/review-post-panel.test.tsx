// Posting from the Review Draft view (#30): the confirm step, posting, partial failure, success
// and the missing api scope. The worker is stubbed.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
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

const preview: PostPreview = {
  url: URL,
  comments: 2,
  leftoverDrafts: [{ id: 41, body: 'Started in the browser' }],
  warnings: ['The MR has new commits since 2 Review Comments were written: GitLab may show them as outdated.']
}

const persisted = { plugin: { 'rr.tab': 'in', 'rr.draftUrl': URL } }

async function openDraft(requests: Record<string, unknown>, canPost: boolean | null = null) {
  const host = mockHost({
    requests: {
      'rr.snapshot': snapshot,
      'rr.connection': connection(canPost),
      'rr.draft': draft([comment('note:n1'), comment('note:n2')]),
      'rr.postPreview': preview,
      ...requests
    }
  })
  const view = await mount(panel, { host, persisted })
  return { host, view }
}

test('Post opens the confirm step: what posts, the leftover GitLab drafts, warnings, summary and outcome', async () => {
  const { view } = await openDraft({})

  await view.press(view.find({ type: 'Button', text: 'Post 2 to GitLab' })!)

  assert.ok(view.find({ type: 'Heading', text: 'Post review' }))
  assert.ok(view.find({ text: '2 Review Comments post as one review.' }))
  assert.ok(view.find({ type: 'Callout', label: 'Your other GitLab drafts on this MR publish too' }))
  assert.ok(view.find({ text: 'Started in the browser' }))
  assert.ok(view.find({ text: /new commits since 2 Review Comments/ }))
  assert.equal(view.valueOf(view.find({ type: 'Select', label: 'Outcome' })!), 'comment')
  assert.ok(view.find({ type: 'Textarea', label: 'Summary' }))

  await view.press(view.find({ type: 'Button', text: 'Cancel' })!)
  assert.equal(view.find({ type: 'Heading', text: 'Post review' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Post review sends the summary and outcome, then shows the review posted', async () => {
  const sent: unknown[] = []
  const { view } = await openDraft({
    'rr.postReview': (input: unknown): PostResult => {
      sent.push(input)
      return {
        posted: 2,
        failed: [],
        approveError: null,
        draft: draft([comment('note:n1', { posted: true }), comment('note:n2', { posted: true })])
      }
    }
  })
  await view.press(view.find({ type: 'Button', text: 'Post 2 to GitLab' })!)
  await view.type(view.find({ type: 'Textarea', label: 'Summary' })!, 'Nearly there.')
  await view.select(view.find({ type: 'Select', label: 'Outcome' })!, 'requested_changes')

  await view.press(view.find({ type: 'Button', text: 'Post review' })!)

  assert.deepEqual(sent, [{ url: URL, summary: 'Nearly there.', outcome: 'requested_changes' }])
  assert.ok(view.find({ type: 'Callout', label: 'Review posted' }))
  assert.ok(view.find({ text: /2 Review Comments posted/ }))
  assert.ok(view.find({ text: /clear the posted notes in Orca's diff view/i }))
  assert.equal(view.findAll({ type: 'Badge', text: 'Posted' }).length, 2)
  assert.equal(view.find({ type: 'Heading', text: 'Post review' }), null)
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
  await view.press(view.find({ type: 'Button', text: 'Post 2 to GitLab' })!)
  await view.press(view.find({ type: 'Button', text: 'Post review' })!)

  assert.ok(view.find({ type: 'Callout', label: "1 Review Comment couldn't be posted" }))
  assert.ok(view.find({ text: 'src/login.ts:10: GitLab kept it as a draft: it did not publish.' }))
  assert.ok(view.find({ type: 'Callout', label: 'Not approved' }))
  assert.ok(view.find({ text: /Not posted: GitLab kept it as a draft/ }))

  await view.press(view.find({ type: 'Button', text: 'Delete failed drafts' })!)
  assert.deepEqual(deleted, [{ url: URL }])
  assert.equal(view.find({ text: /Not posted:/ }), null)
  assert.ok(view.find({ type: 'Button', text: 'Post 1 to GitLab' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Retry after a partial failure opens the confirm step again', async () => {
  const { view } = await openDraft({
    'rr.postReview': (): PostResult => ({
      posted: 0,
      failed: [{ commentId: 'note:n2', location: 'src/login.ts:10', message: 'kept as a draft' }],
      approveError: null,
      draft: draft([comment('note:n1'), comment('note:n2', { failure: 'kept as a draft' })])
    })
  })
  await view.press(view.find({ type: 'Button', text: 'Post 2 to GitLab' })!)
  await view.press(view.find({ type: 'Button', text: 'Post review' })!)

  await view.press(view.find({ type: 'Button', text: 'Retry' })!)

  assert.ok(view.find({ type: 'Heading', text: 'Post review' }))
  await view.unmount()
})

test('a refused post says why and keeps the confirm step open', async () => {
  const { view } = await openDraft({
    'rr.postReview': () => {
      throw hostError('internal', 'Posting a review needs a token with the api scope. GitLab said: 403 insufficient_scope')
    }
  })
  await view.press(view.find({ type: 'Button', text: 'Post 2 to GitLab' })!)
  await view.press(view.find({ type: 'Button', text: 'Post review' })!)

  assert.ok(view.find({ type: 'Callout', label: "Couldn't post the Review Draft" }))
  assert.ok(view.find({ text: /needs a token with the api scope/ }))
  assert.ok(view.find({ type: 'Heading', text: 'Post review' }))
  await view.unmount()
})

test('without the api scope, Post is disabled with the hint', async () => {
  const { view } = await openDraft({}, false)

  const post = view.find({ type: 'Button', text: 'Post 2 to GitLab' })!
  assert.equal(post.disabled, true)
  assert.ok(view.find({ text: 'Posting a review needs a token with the api scope.' }))
  await view.unmount()
})

test('the confirm step survives a panel reload; a post whose answer was lost goes back to the Post button', async () => {
  const confirm = { kind: 'confirm', preview, postingSince: null }
  const reopened = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': snapshot, 'rr.draft': draft([comment('note:n1')]) } }),
    persisted: { plugin: { ...persisted.plugin, 'rr.postStep': confirm, 'rr.postSummary': 'Half written' } }
  })
  assert.ok(reopened.find({ type: 'Heading', text: 'Post review' }))
  assert.equal(reopened.valueOf(reopened.find({ type: 'Textarea', label: 'Summary' })!), 'Half written')
  await reopened.unmount()

  const stale = { kind: 'confirm', preview, postingSince: Date.now() - 10 * 60_000 }
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': snapshot, 'rr.draft': draft([comment('note:n1')]) } }),
    persisted: { plugin: { ...persisted.plugin, 'rr.postStep': stale } }
  })
  assert.equal(view.find({ type: 'Heading', text: 'Post review' }), null)
  assert.ok(view.find({ type: 'Button', text: 'Post 1 to GitLab' }))
  await view.unmount()
})

test('while posting, the confirm step is locked', async () => {
  // The kit's press waits for the request, so the in-flight state is seeded (as after a reload).
  const posting = { kind: 'confirm', preview, postingSince: Date.now() }
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': snapshot, 'rr.draft': draft([comment('note:n1')]) } }),
    persisted: { plugin: { ...persisted.plugin, 'rr.postStep': posting } }
  })

  assert.equal(view.find({ type: 'Button', text: 'Post review' })!.disabled, true)
  assert.equal(view.find({ type: 'Button', text: 'Cancel' })!.disabled, true)
  assert.ok(view.find({ type: 'Spinner', label: 'Posting' }))
  await view.unmount()
})

test('an Ended card opens its Review Draft too', async () => {
  const ended: ReviewRequestsSnapshot = {
    reviewRequests: [],
    refreshedAt: NOW,
    ended: [{ ...inReview, workspace: WORKSPACE, reason: 'merged', endedAt: NOW, autoRemoveSkipped: null }]
  }
  const host = mockHost({ requests: { 'rr.snapshot': ended, 'rr.draft': draft([comment('note:n1')]) } })
  const view = await mount(panel, { host, persisted: { plugin: { 'rr.tab': 'ended' } } })

  await view.press(view.find({ type: 'Button', text: 'Review draft' })!)

  assert.ok(view.find({ type: 'Heading', text: 'Review Draft' }))
  await view.unmount()
})
