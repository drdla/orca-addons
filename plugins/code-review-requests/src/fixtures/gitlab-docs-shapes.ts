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
