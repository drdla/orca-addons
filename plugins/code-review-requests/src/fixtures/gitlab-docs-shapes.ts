// Shapes that could not be captured read-only, taken from the GitLab docs instead.

/**
 * A draft note, as in the example of "List all merge request draft notes" on
 * https://docs.gitlab.com/api/draft_notes/ (checked 2026-11-16). `POST …/draft_notes` returns
 * the created draft in the same shape. `bulk_publish` and `DELETE …/draft_notes/:id` answer
 * 204 with no body (the docs show no response for them).
 */
export const draftNoteFromDocs = {
  id: 5,
  author_id: 23,
  merge_request_id: 11,
  resolve_discussion: false,
  discussion_id: null,
  note: 'Example title',
  commit_id: null,
  line_code: null,
  position: {
    base_sha: null,
    start_sha: null,
    head_sha: null,
    old_path: null,
    new_path: null,
    position_type: 'text',
    old_line: null,
    new_line: null,
    line_range: null
  }
}

/**
 * A personal access token, as in the example of "Get details on a personal access token"
 * (`GET /personal_access_tokens/self`) on https://docs.gitlab.com/api/personal_access_tokens/.
 * Used to read the scopes of the token in use (#8, #25); `description` may be null.
 */
export const personalAccessTokenFromDocs = {
  id: 4,
  name: 'Test Token',
  revoked: false,
  created_at: '2020-07-23T14:31:47.729Z',
  description: 'Test Token description',
  scopes: ['api'],
  user_id: 3,
  last_used_at: '2021-10-06T17:58:37.550Z',
  active: true,
  expires_at: null
}

/**
 * One MR diff version, as in the example of "Retrieve merge request diff versions"
 * (`GET /projects/:id/merge_requests/:iid/versions`, newest first) on
 * https://docs.gitlab.com/api/merge_requests/ (checked 2026-11-16). Posting (#30) looks up a
 * Review Comment's commit here to post against that version's SHAs.
 */
export const mergeRequestVersionFromDocs = {
  id: 110,
  head_commit_sha: '33e2ee8579fda5bc36accc9c6fbd0b4fefda9e30',
  base_commit_sha: 'eeb57dffe83deb686a60a71c16c32f71046868fd',
  start_commit_sha: 'eeb57dffe83deb686a60a71c16c32f71046868fd',
  created_at: '2016-07-26T14:44:48.926Z',
  merge_request_id: 105,
  state: 'collected',
  real_size: '1',
  patch_id_sha: 'd504412d5b6e6739647e752aff8e468dde093f2f'
}

/**
 * A merge request note, as in the example of "Retrieve a merge request note" on
 * https://docs.gitlab.com/api/notes/ (checked 2026-11-16). `POST …/notes` (the `/submit_review`
 * note on GitLab 17.4–19.1, #30) answers a note; the plugin reads nothing from it.
 */
export const mergeRequestNoteFromDocs = {
  id: 301,
  body: 'Comment for MR',
  author: { id: 1, username: 'pipin', name: 'Pip', state: 'active', created_at: '2013-09-30T13:46:01Z' },
  created_at: '2013-10-02T08:57:14Z',
  updated_at: '2013-10-02T08:57:14Z',
  system: false,
  noteable_id: 2,
  noteable_type: 'MergeRequest',
  noteable_iid: 2,
  project_id: 5,
  resolvable: false,
  confidential: false,
  internal: false
}

/**
 * The fields the Review Requests query added for the card badges (#10) after the capture was
 * taken, typed as in the GraphQL reference for `MergeRequest` on
 * https://docs.gitlab.com/api/graphql/reference/ (checked 2026-11-16): `approvalsRequired`,
 * `approvalsLeft` and `userNotesCount` are `Int`, `headPipeline` a nullable `Pipeline` whose
 * `status` is a `PipelineStatusEnum`. Merged into each captured node for the shape check.
 */
export const reviewRequestNodeBadgesFromDocs = {
  approvalsRequired: 2,
  approvalsLeft: 1,
  userNotesCount: 4,
  headPipeline: { status: 'SUCCESS' }
}
