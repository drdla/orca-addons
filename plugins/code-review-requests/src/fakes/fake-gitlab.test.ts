import { assert, test } from 'orca/testing'
import {
  REVIEW_REQUESTS_QUERY,
  type ReviewRequestsResponse
} from '../gitlab/review-requests-query'
import { GitLabError } from '../seams/gitlab'
import { FakeClock } from './fake-clock'
import { FakeGitLab } from './fake-gitlab'

function reviewRequests(gitlab: FakeGitLab, after?: string) {
  return gitlab.graphql<ReviewRequestsResponse>(REVIEW_REQUESTS_QUERY, {
    me: 'me',
    ...(after ? { after } : {})
  })
}

function iids(response: ReviewRequestsResponse): number[] {
  return response.currentUser.reviewRequestedMergeRequests.nodes.map((n) => Number(n.iid))
}

test('the Review Requests query returns open, non-draft MRs I review and have not approved', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  gitlab.addMergeRequest({ iid: 1, projectPath: 'acme/api', title: 'Waiting on me' })
  gitlab.addMergeRequest({ iid: 2, projectPath: 'acme/api', draft: true })
  gitlab.addMergeRequest({ iid: 3, projectPath: 'acme/api', reviewers: ['someone-else'] })
  gitlab.addMergeRequest({ iid: 4, projectPath: 'acme/api', approvedBy: ['me'] })
  gitlab.addMergeRequest({ iid: 5, projectPath: 'acme/api', state: 'merged' })

  const response = await reviewRequests(gitlab)

  assert.equal(response.currentUser.username, 'me')
  assert.equal(response.currentUser.reviewRequestedMergeRequests.count, 1)
  const [node] = response.currentUser.reviewRequestedMergeRequests.nodes
  assert.equal(node?.title, 'Waiting on me')
  assert.equal(node?.webUrl, 'https://gitlab.example.com/acme/api/-/merge_requests/1')
  assert.equal(node?.project.fullPath, 'acme/api')
  assert.equal(node?.project.group?.fullPath, 'acme')
  assert.deepEqual(node?.reviewers.nodes.map((r) => r.username), ['me'])
})

test('the list is newest-updated first and pages by cursor', async () => {
  const clock = new FakeClock(0)
  const gitlab = new FakeGitLab({ me: 'me', clock, pageSize: 2 })
  for (const iid of [1, 2, 3]) {
    gitlab.addMergeRequest({ iid, projectPath: 'acme/api' })
    await clock.advance(1_000)
  }

  const first = await reviewRequests(gitlab)
  assert.deepEqual(iids(first), [3, 2])
  const page = first.currentUser.reviewRequestedMergeRequests.pageInfo
  assert.equal(page.hasNextPage, true)
  assert.equal(first.currentUser.reviewRequestedMergeRequests.count, 3)

  const second = await reviewRequests(gitlab, page.endCursor ?? undefined)
  assert.deepEqual(iids(second), [1])
  assert.equal(second.currentUser.reviewRequestedMergeRequests.pageInfo.hasNextPage, false)
})

test('changes to an MR show up in the next poll', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  for (const iid of [1, 2, 3, 4, 5]) gitlab.addMergeRequest({ iid, projectPath: 'acme/api' })

  await gitlab.rest('POST', '/projects/acme%2Fapi/merge_requests/1/approve')
  gitlab.merge('acme/api', 2)
  gitlab.close('acme/api', 3)
  gitlab.removeReviewer('acme/api', 4)

  assert.deepEqual(iids(await reviewRequests(gitlab)), [5])

  gitlab.markDraft('acme/api', 5)
  assert.deepEqual(iids(await reviewRequests(gitlab)), [])
})

test('draft notes are listed, then published as one review', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  gitlab.addMergeRequest({ iid: 7, projectPath: 'acme/api' })
  const base = '/projects/acme%2Fapi/merge_requests/7'

  const mr = await gitlab.rest<{ diff_refs: { head_sha: string } }>('GET', base)
  await gitlab.rest('POST', `${base}/draft_notes`, { note: 'General remark' })
  await gitlab.rest('POST', `${base}/draft_notes`, {
    note: 'On a line',
    position: { position_type: 'text', head_sha: mr.diff_refs.head_sha, new_path: 'a.ts', new_line: 3 }
  })
  const drafts = await gitlab.rest<{ id: number; note: string }[]>('GET', `${base}/draft_notes`)
  assert.deepEqual(drafts.map((d) => d.note), ['General remark', 'On a line'])

  await gitlab.rest('POST', `${base}/draft_notes/bulk_publish`, { note: 'Summary' })

  assert.deepEqual(await gitlab.rest('GET', `${base}/draft_notes`), [])
  assert.deepEqual(gitlab.reviewsOf('acme/api', 7), [
    { summary: 'Summary', reviewerState: null, notes: ['General remark', 'On a line'] }
  ])
})

test('each push adds an MR diff version, newest first', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  gitlab.addMergeRequest({ iid: 7, projectPath: 'acme/api' })
  const base = '/projects/acme%2Fapi/merge_requests/7'
  const first = await gitlab.rest<{ diff_refs: { head_sha: string } }>('GET', base)
  gitlab.push('acme/api', 7)
  const second = await gitlab.rest<{ diff_refs: { head_sha: string; base_sha: string } }>('GET', base)

  const versions = await gitlab.rest<{ head_commit_sha: string; base_commit_sha: string }[]>('GET', `${base}/versions`)

  assert.deepEqual(versions.map((v) => v.head_commit_sha), [second.diff_refs.head_sha, first.diff_refs.head_sha])
  assert.equal(versions[0]!.base_commit_sha, second.diff_refs.base_sha)
})

test('a draft on a line outside the diff fails to publish and stays a draft; the rest publishes', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  gitlab.addMergeRequest({ iid: 7, projectPath: 'acme/api' })
  gitlab.outsideDiff('acme/api', 7, 'a.ts', 99)
  const base = '/projects/acme%2Fapi/merge_requests/7'
  await gitlab.rest('POST', `${base}/draft_notes`, { note: 'fine' })
  await gitlab.rest('POST', `${base}/draft_notes`, {
    note: 'stale',
    position: { position_type: 'text', new_path: 'a.ts', new_line: 99 }
  })

  await gitlab.rest('POST', `${base}/draft_notes/bulk_publish`)

  const left = await gitlab.rest<{ note: string }[]>('GET', `${base}/draft_notes`)
  assert.deepEqual(left.map((d) => d.note), ['stale'])
  assert.deepEqual(gitlab.reviewsOf('acme/api', 7).map((r) => r.notes), [['fine']])
})

test('GitLab before 19.2 ignores the summary and state on bulk_publish; a /submit_review note publishes instead', async () => {
  const gitlab = new FakeGitLab({ me: 'me', version: '18.11.0' })
  gitlab.addMergeRequest({ iid: 7, projectPath: 'acme/api' })
  const base = '/projects/acme%2Fapi/merge_requests/7'
  await gitlab.rest('POST', `${base}/draft_notes`, { note: 'one' })
  await gitlab.rest('POST', `${base}/draft_notes/bulk_publish`, { note: 'ignored', reviewer_state: 'requested_changes' })
  await gitlab.rest('POST', `${base}/draft_notes`, { note: 'two' })

  await gitlab.rest('POST', `${base}/notes`, { body: 'Looks good overall.\n\n/submit_review requested_changes' })

  assert.deepEqual(gitlab.reviewsOf('acme/api', 7), [
    { summary: null, reviewerState: null, notes: ['one'] },
    { summary: 'Looks good overall.', reviewerState: 'requested_changes', notes: ['two'] }
  ])
  assert.deepEqual(gitlab.notesOf('acme/api', 7), ['Looks good overall.'])
})

test('a token without the api scope may read but not write', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  gitlab.addMergeRequest({ iid: 7, projectPath: 'acme/api' })
  gitlab.issueToken('glpat-READ', ['read_api'])
  const viaToken = gitlab.withToken('glpat-READ')
  const base = '/projects/acme%2Fapi/merge_requests/7'

  assert.deepEqual(await viaToken.rest('GET', `${base}/draft_notes`), [])
  await assert.rejects(viaToken.rest('POST', `${base}/draft_notes`, { note: 'x' }), /403/)
})

test('the current user and version answer over REST', async () => {
  const gitlab = new FakeGitLab({ me: 'me', version: '17.4.0' })
  assert.deepEqual(await gitlab.rest('GET', '/user'), { id: 1, username: 'me', name: 'me' })
  assert.deepEqual(await gitlab.rest('GET', '/version'), { version: '17.4.0' })
})

test('an injected failure rejects the next call only, and every call is recorded', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  gitlab.failNext(new GitLabError('transient', 'HTTP 503', { status: 503 }))

  await assert.rejects(reviewRequests(gitlab), (error) => {
    return error instanceof GitLabError && error.kind === 'transient' && error.status === 503
  })
  await reviewRequests(gitlab)
  assert.deepEqual(
    gitlab.requests.map((r) => r.operation),
    ['graphql ReviewRequests', 'graphql ReviewRequests']
  )
})

test('an unknown REST route is rejected like a 404', async () => {
  const gitlab = new FakeGitLab({ me: 'me' })
  await assert.rejects(gitlab.rest('GET', '/nope'), (error) => {
    return error instanceof GitLabError && error.kind === 'rejected' && error.status === 404
  })
})
