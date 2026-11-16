// Pins the fakes to the sanitized real captures: what the fake GitLab and the fake orca CLI
// answer must have the shape real GitLab and Orca answered with (#16, "Fixture provenance").
import { assert, test } from 'orca/testing'
import { REVIEW_REQUESTS_QUERY, type ReviewRequestsResponse } from '../gitlab/review-requests-query'
import { FakeGitLab, FakeOrcaCli } from '../fakes'
import type { Worktree, WorktreeDetail } from '../seams/orca-cli'
import {
  draftNoteFromDocs,
  mergeRequestNoteFromDocs,
  mergeRequestVersionFromDocs,
  personalAccessTokenFromDocs
} from './gitlab-docs-shapes'
import { mergeRequestBody, reviewRequestsBody } from './gitlab-captures'
import { mergeRequestReviewersBody } from './gitlab-reviewers-capture'
import { worktreeListEnvelope, worktreeShowEnvelope, worktreeShowErrorEnvelope } from './orca-cli-captures'
import { shapeMismatches } from './shape'

// Compile-time half of the contract: the captures fit the types the plugin reads them as.
const _rr: ReviewRequestsResponse = reviewRequestsBody.data as ReviewRequestsResponse
const _rows: Worktree[] = worktreeListEnvelope.result.worktrees
const _detail: WorktreeDetail = worktreeShowEnvelope.result.worktree
void [_rr, _rows, _detail]

function seeded(): FakeGitLab {
  const gitlab = new FakeGitLab({ me: 'me' })
  gitlab.addMergeRequest({ projectPath: 'acme/team-1/service-1', iid: 101, labels: ['backend'] })
  return gitlab
}

test('the fake answers the Review Requests query in the shape GitLab does', async () => {
  const response = await seeded().graphql(REVIEW_REQUESTS_QUERY, { me: 'me' })

  assert.deepEqual(shapeMismatches(response, reviewRequestsBody.data, { exact: true }), [])
})

test('the fake merge request carries only fields GitLab sends, diff_refs included', async () => {
  const mr = await seeded().rest('GET', '/projects/acme%2Fteam-1%2Fservice-1/merge_requests/101')

  assert.deepEqual(shapeMismatches(mr, mergeRequestBody), [])
})

test('the fake lists merge request reviewers in the shape GitLab does', async () => {
  const reviewers = await seeded().rest('GET', '/projects/acme%2Fteam-1%2Fservice-1/merge_requests/101/reviewers')

  assert.deepEqual(shapeMismatches(reviewers, mergeRequestReviewersBody, { exact: true }), [])
})

test('the fake draft notes look like the documented draft note', async () => {
  const gitlab = seeded()
  const base = '/projects/acme%2Fteam-1%2Fservice-1/merge_requests/101/draft_notes'
  const created = await gitlab.rest('POST', base, { note: 'General remark' })
  const listed = await gitlab.rest('GET', base)

  assert.deepEqual(shapeMismatches(created, draftNoteFromDocs, { exact: true }), [])
  assert.deepEqual(shapeMismatches(listed, [draftNoteFromDocs], { exact: true }), [])
})

test('the fake lists MR diff versions and answers a note in the documented shapes', async () => {
  const gitlab = seeded()
  const base = '/projects/acme%2Fteam-1%2Fservice-1/merge_requests/101'
  gitlab.push('acme/team-1/service-1', 101)

  const versions = await gitlab.rest('GET', `${base}/versions`)
  const note = await gitlab.rest('POST', `${base}/notes`, { body: 'Summary\n\n/submit_review reviewed' })

  assert.deepEqual(shapeMismatches(versions, [mergeRequestVersionFromDocs, mergeRequestVersionFromDocs], { exact: true }), [])
  assert.deepEqual(shapeMismatches(note, mergeRequestNoteFromDocs, { exact: true }), [])
})

test('the fake describes a personal access token in the documented shape, for token mode and glab alike', async () => {
  const gitlab = seeded()
  gitlab.issueToken('glpat-FAKE', ['read_api'])
  gitlab.glabScopes = ['api']

  const viaToken = await gitlab.withToken('glpat-FAKE').rest('GET', '/personal_access_tokens/self')
  const viaGlab = await gitlab.rest('GET', '/personal_access_tokens/self')

  assert.deepEqual(shapeMismatches(viaToken, personalAccessTokenFromDocs, { exact: true }), [])
  assert.deepEqual(shapeMismatches(viaGlab, personalAccessTokenFromDocs, { exact: true }), [])
  assert.deepEqual([(viaToken as { scopes: string[] }).scopes, (viaGlab as { scopes: string[] }).scopes], [['read_api'], ['api']])
})

test('the fake orca CLI lists and shows worktrees in the shape Orca does', async () => {
  const cli = new FakeOrcaCli()
  const added = cli.addWorktree({ name: 'review-101', references: ['https://gitlab.example.com/acme/api/-/merge_requests/101'] })

  const [row] = await cli.listWorktrees()
  const detail = await cli.showWorktree(`id:${added.id}`)

  assert.deepEqual(shapeMismatches({ ...row, linkedItems: [] }, worktreeListEnvelope.result.worktrees[1]), [])
  assert.deepEqual(shapeMismatches({ ...detail, linkedItems: [], diffComments: [] }, worktreeShowEnvelope.result.worktree), [])
})

test('the fake orca CLI names branches as full refs, like Orca', async () => {
  const cli = new FakeOrcaCli()
  cli.addWorktree({ name: 'review-101', branch: 'feature/change-1' })

  const [row] = await cli.listWorktrees()

  assert.equal(row?.branch, 'refs/heads/feature/change-1')
  assert.match(worktreeListEnvelope.result.worktrees[1]!.branch, /^refs\/heads\//)
})

test('the fake orca CLI reports the project and the legacy GitLab MR link on each row, like Orca', async () => {
  const cli = new FakeOrcaCli()
  cli.addWorktree({
    name: 'review-101',
    projectId: 'git:gitlab.example.com/acme/api',
    references: ['https://gitlab.example.com/acme/api/-/merge_requests/101']
  })
  cli.addWorktree({ name: 'plain' })

  const rows = await cli.listWorktrees()

  assert.deepEqual(
    rows.map((r) => [r.projectId, r.linkedGitLabMR, r.isMainWorktree]),
    [
      ['git:gitlab.example.com/acme/api', 101, false],
      ['git:gitlab.example.com/acme/api', null, false]
    ]
  )
  assert.match(worktreeListEnvelope.result.worktrees[0]!.projectId, /^git:gitlab\.example\.com\/acme\//)
})

test('an unknown selector fails with the error code Orca uses', async () => {
  const cli = new FakeOrcaCli()

  await assert.rejects(cli.showWorktree('id:nope'), (e: unknown) => {
    return (e as { code?: string }).code === worktreeShowErrorEnvelope.error.code
  })
})
