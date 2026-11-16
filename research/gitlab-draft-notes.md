# How do GitLab draft notes post a batched review?

Research for [#13](https://github.com/drdla/orca-addons/issues/13) (map [#1](https://github.com/drdla/orca-addons/issues/1)). Context: [#5](https://github.com/drdla/orca-addons/issues/5) (query research), [#6](https://github.com/drdla/orca-addons/issues/6) (actions; "Post review to GitLab" in v1).

Researched 2026-11-16 against gitlab.com (`GET /version` reported `19.6.0-pre`), GitLab source (`gitlab-org/gitlab`, `master` and release tags), and `glab` 1.119.0.
Live checks were read-only: GraphQL schema introspection, `GET` on a public MR's `diff_refs` and `versions`, and `GET .../draft_notes` (200, own drafts only). No draft notes, notes or approvals were created, published or deleted. No mutations were run.

## Answer in one screen

- **Batched reviews are REST-only.** The GraphQL schema has no draft-note type, no draft-note mutation, no "submit review" mutation and no MR approve mutation (introspected on gitlab.com 19.6-pre). Use REST `draft_notes` + `bulk_publish`, and REST `approve`.
- **Call sequence** (same for glab and token; only the transport differs):
  1. `GET /version` once per instance, to pick the submit path (19.2+ or older).
  2. `GET /projects/:id/merge_requests/:iid` and read `diff_refs { base_sha, start_sha, head_sha }` (or `GET .../versions`, newest first). Compare `head_sha` with the SHA the review was written against (see "When the MR moved on").
  3. `GET /projects/:id/merge_requests/:iid/draft_notes`. `bulk_publish` publishes **all** of the user's pending drafts on the MR, including ones started in the web UI. If any exist, warn before submitting.
  4. `POST /projects/:id/merge_requests/:iid/draft_notes` once per comment: `{ "note": "...", "position": {...} }` for a line comment, `{ "note": "..." }` for a general comment. The first draft sets the reviewer state to `review_started`.
  5. Submit:
     - **GitLab 19.2+:** `POST .../draft_notes/bulk_publish` with `{ "note": "<summary>", "reviewer_state": "requested_changes" | "reviewed" }`.
     - **GitLab 17.4 to 19.1:** `POST .../draft_notes/bulk_publish` (no body; extra fields are not declared there). Then `POST /projects/:id/merge_requests/:iid/notes` with body `<summary>` plus a quick action line: `/request_changes` for request changes. Alternatively, skip `bulk_publish` and post one note `"<summary>\n\n/submit_review requested_changes"` (or `reviewed`, `approve`). `/submit_review <state>` exists since 17.0.
  6. Approve (if chosen): `POST /projects/:id/merge_requests/:iid/approve` with `sha=<head_sha>`. `reviewer_state` cannot be `approved`; the docs say it "Does not record a formal approval."
  7. `GET .../draft_notes` again. Since partial failures still return 204 on current GitLab, leftover drafts are the ones that failed (for example a stale line).
- **glab:** `glab api --hostname <host> -X POST projects/<url-encoded path>/merge_requests/<iid>/draft_notes -H 'Content-Type: application/json' --input body.json`, and the same for `bulk_publish`, `notes`, `approve`. glab also has native (EXPERIMENTAL) commands: `glab mr note create --draft --file <path> --line <n|a:b> | --old-line <n>`, `glab mr note publish -m <summary> --reviewer-state requested_changes|reviewed --yes`, `glab mr approve --sha <sha>`. They are useful for manual testing but pin to the **latest** diff version (no SHA control), so the plugin should use `glab api`.
- **Token:** the same REST calls on `https://<host>/api/v4/...` with `Authorization: Bearer <PAT>` (or `PRIVATE-TOKEN`). Posting needs the **`api`** scope. `read_api` (enough for listing, #5) can read draft notes but cannot create or publish them.
- **Minimum version:** 17.4 stays the plugin's floor (from #5). Draft-note `position` needs 16.3+, `bulk_publish` 15.11+, `/submit_review <state>` 17.0+, and the `bulk_publish` summary and `reviewer_state` 19.2+. Request changes is Premium/Ultimate; without it, the state falls back to `reviewed` (19.2+ API) or the quick action does nothing.

## Evidence

### Draft notes REST API

Docs: [Draft notes API](https://docs.gitlab.com/api/draft_notes/). Source: `lib/api/draft_notes.rb`, `app/services/draft_notes/publish_service.rb`, `app/services/draft_notes/create_service.rb` (gitlab-org/gitlab `master`).

Endpoints (all under `/projects/:id/merge_requests/:merge_request_iid`):

| Method | Path | Notes |
|---|---|---|
| GET | `/draft_notes` | Only the caller's own drafts (`authored_by(current_user)`). |
| GET | `/draft_notes/:draft_note_id` | |
| POST | `/draft_notes` | `note` (required), `in_reply_to_discussion_id`, `commit_id`, `resolve_discussion`, `position`. |
| PUT | `/draft_notes/:draft_note_id` | `note` required. Omitting `position` keeps the old one. |
| DELETE | `/draft_notes/:draft_note_id` | |
| PUT | `/draft_notes/:draft_note_id/publish` | Publishes one draft, outside a review. |
| POST | `/draft_notes/bulk_publish` | Publishes all of the caller's drafts as one review. |

- `bulk_publish` creates one `Review` record and turns each draft into a note linked to it (`create_review` in `PublishService`). This is what makes it "one review" (one notification email, grouped in the activity feed).
- Optional `bulk_publish` params on current GitLab: `note` ("Text of the summary note to add to the merge request"), `internal` (summary is internal), `reviewer_state` (`requested_changes` or `reviewed`; "Does not record a formal approval. If you can't request changes, sets `reviewed` instead").
- In the API, the summary note is created with `Notes::CreateService` **after** publishing and without a `review_id`, so it is a separate MR comment, not part of the review record. The web UI's `DraftsController#publish` can attach it to the review behind the `improved_review_email` flag; the API does not.
- Quick actions in the summary are checked before anything is published (`check_quick_actions!`). So a summary like `/approve` is allowed if the token scope permits quick actions.
- Rate limit: `check_notes_create_rate_limit!(cost: drafts + summary)`. Each draft counts against the notes-create limit.
- Partial failures (current `master`): a review "is published even when some of its drafts fail". Failed drafts are kept for non-bot users so they can be fixed and resubmitted. The endpoint still returns 204.
- Creating the first draft sets the caller's reviewer state to `review_started` (`CreateService`, "Update reviewer state to `REVIEW_STARTED` when a new review has started").

Version history, from `lib/api/draft_notes.rb` at release tags:

| Tag | API file | `bulk_publish` | `position` / `line_range` | `reviewer_state` + summary `note` |
|---|---|---|---|---|
| v15.8.0-ee | absent | | | |
| v15.10.0-ee | present | no | no | no |
| v15.11.0-ee | present | yes | no | no |
| v16.2.0-ee | present | yes | no | no |
| v16.3.0-ee | present | yes | yes | no |
| v19.1.0-ee | present | yes | yes | no |
| v19.2.0-ee | present | yes | yes | yes |

The docs page has no version-history notes for any of this. The table comes from the source at each tag.

Before 19.2 the endpoint neither declares nor reads `note`/`reviewer_state`, so sending them should be silently ignored rather than rejected. That is an inference from the source, not tested live. The plugin should branch on `GET /version` instead of relying on it.

### Submitting with a state before 19.2: quick actions

Docs: [Quick actions](https://docs.gitlab.com/user/project/quick_actions/). Source: `lib/gitlab/quick_actions/merge_request_actions.rb`.

- `/submit_review` exists since at least 16.0. Since **17.0** it takes a state: `command :submit_review do |state = "reviewed"|`. It runs `DraftNotes::PublishService` (same review grouping as `bulk_publish`), then:
  - `approve` → `MergeRequests::ApprovalService` (a real approval),
  - any other `MergeRequestReviewer` state (`reviewed`, `requested_changes`) → `UpdateReviewerStateService`.
- `/request_changes` exists since 16.6 and needs the caller to be a reviewer.
- `/approve` and `/unapprove` exist on all versions in range.
- Quick actions work in `POST .../notes` bodies. Text around the command is saved as a normal comment.

### Approve, request changes, summary

Docs: [Merge request reviews](https://docs.gitlab.com/user/project/merge_requests/reviews/), [Merge request approvals API](https://docs.gitlab.com/api/merge_request_approvals/).

- The web UI's submit dialog offers **Comment**, **Approve**, **Request changes**, plus an optional summary. "Using **Approve** to submit pending review comments" was introduced in 18.6. The web UI goes through an internal controller (`DraftsController#publish`, which accepts `reviewer_state: approved` and an `approve` param), not the public API.
- Public API equivalents:
  - Summary: `bulk_publish` `note` (19.2+) or a separate `POST .../notes`.
  - Request changes / reviewed: `bulk_publish` `reviewer_state` (19.2+) or the `/submit_review <state>` / `/request_changes` quick action (17.0+).
  - Approve: `POST /projects/:id/merge_requests/:iid/approve`, optional `sha` ("ensures you're approving the current version"), and `approval_password` if the project requires re-authentication to approve. Or `/submit_review approve` / `/approve`.
- **Request changes** is Premium/Ultimate. It was introduced in 16.11 behind `mr_reviewer_requests_changes` (default off), enabled by default in 17.2, and the flag was removed in 17.3. Since 19.6 it requires permission to approve; without it "the review is submitted as a comment". It blocks merge until the same user approves (or, per the current API source, re-reviews with `reviewed`).
- GraphQL has no MR approve mutation and no reviewer-state mutation (introspection, see below).

### Position fields and where to get them

Docs: [Discussions API, "Create a new thread in the merge request diff"](https://docs.gitlab.com/api/discussions/), [Draft notes API](https://docs.gitlab.com/api/draft_notes/). Source: the `params :positional` block in `lib/api/draft_notes.rb`.

```json
{
  "note": "Consider extracting this.",
  "position": {
    "position_type": "text",
    "base_sha": "<diff_refs.base_sha>",
    "start_sha": "<diff_refs.start_sha>",
    "head_sha": "<diff_refs.head_sha>",
    "old_path": "src/a.ts",
    "new_path": "src/a.ts",
    "new_line": 18,
    "line_range": {
      "start": { "line_code": "<sha1(path)>_<old_pos>_<new_pos>", "type": "new", "new_line": 12 },
      "end":   { "line_code": "<sha1(path)>_<old_pos>_<new_pos>", "type": "new", "new_line": 18 }
    }
  }
}
```

- `base_sha`, `start_sha`, `head_sha`, `position_type` are required when `position` is sent. `old_path`/`new_path` are needed for `text` (send both, equal for unmodified paths).
- What they mean: `base_sha` is the merge base, `start_sha` is the target-branch commit the diff was computed against, and `head_sha` is the source-branch HEAD.
- **Where to get them:** `diff_refs` on `GET /projects/:id/merge_requests/:iid` (live: keys `base_sha`, `head_sha`, `start_sha`, 40-char SHAs). The same is available as GraphQL `MergeRequest.diffRefs { baseSha headSha startSha }`, so the list query from #5 can fetch it at no extra cost. Older diff versions are at `GET .../versions` (newest first; `base_commit_sha` → `base_sha`, `head_commit_sha` → `head_sha`, `start_commit_sha` → `start_sha`).
- **Which line number:**
  - Added line: `new_line` only.
  - Removed line: `old_line` only.
  - Unchanged (context) line: both, which can differ.
- **Ranges:** `line_range.start` and `line_range.end`, each with `line_code`, `type` (`new` for added, `old` for removed, omitted for context), and `old_line`/`new_line`. The top-level `new_line`/`old_line` is the **end** line of the range.
- **`line_code`** = `"#{Digest::SHA1.hexdigest(file_path)}_#{old_pos}_#{new_pos}"` (`Gitlab::Git.diff_line_code`, called by `Gitlab::Diff::Line#legacy_id`). `old_pos`/`new_pos` are the hunk counters on **both** sides, even for an added or removed line. So an added line's code still carries the old-side counter. `file_path` is the diff file's path (new path, or old path for deletions). It is optional on create; when missing, GitLab derives the top-level `line_code` from the diff (`DraftNote#find_line_code`). Range line codes are only used to render multi-line comments, so compute them from the local diff hunks.
- `image` and `file` position types exist (`x`/`y`/`width`/`height` for images). They are not needed for v1.

### When the MR moved on since the comment was written

- A draft stores the position exactly as sent. On publish, each draft becomes a `DiffNote` whose diff file is computed from the position's own SHAs (`original_position.diff_file(repository)`), not from the current MR head.
- **Old but valid SHAs** (an earlier MR version): the note is created against that version. GitLab then traces it to newer versions (`Discussions::CaptureDiffNotePositionService`; `DiffNote` keeps `original_position` vs `position`). If the line was changed, the thread shows as outdated ("changed this line in version N"). This is the same as commenting on an old version in the web UI.
- **SHAs or lines that don't resolve:** `DiffNote` validates `line_code` presence for text notes. If GitLab can't find the line in the diff of those SHAs, the note fails to save (inferred from the `DiffNote` validations). On current GitLab the draft is kept and reported in `unpublished_drafts`, while the rest of the review publishes. The Discussions docs also warn that incorrect SHAs can hit a known bug (gitlab-org/gitlab#296829).
- GraphQL `createNote` has `mergeRequestDiffHeadSha` and the deprecated `createLatestDiffNote` has `headSha`, both "guarding against commenting on a stale diff". The draft-note REST API has **no** such guard.
- **Recommendation:**
  1. Record `diff_refs` when the Review Workspace is created (or when the user starts commenting). Its local diff must be `base_sha..head_sha` for the line numbers to match.
  2. At submit, re-read `diff_refs`.
  3. If `head_sha` changed, warn the user ("MR has new commits; comments will attach to the older version and may show as outdated"). Then post with the **recorded** SHAs, provided that version still appears in `GET .../versions`.
  4. Never mix recorded line numbers with current SHAs.
  5. Approve with `sha=<current head_sha>` only after the user confirms.

### GraphQL

Live introspection of gitlab.com (`__schema`, read-only):

- There is no `DraftNote` type and no mutation whose name contains `draft` other than `mergeRequestSetDraft` (the MR draft flag). There is no `submit`/`publish` review mutation.
- Note mutations: `createNote` (`noteableId`, `body`, `internal`, `discussionId`, `mergeRequestDiffHeadSha`), `createDiffNote` (`position: DiffPositionInput!` = `baseSha`, `headSha!`, `startSha!`, `paths { oldPath newPath }`, `oldLine`, `newLine`; no line range), `createImageDiffNote`, and `createLatestDiffNote` (**deprecated**). They post immediately, one notification each, so they can't build a batched review.
- Approvals: only `approveDeployment` and approval-rule mutations. There is no MR approve or unapprove mutation.
- Reviewer mutations: `mergeRequestSetReviewers` and `mergeRequestReviewerRereview`. Neither sets your own review state.
- `MergeRequestReviewState`: `UNREVIEWED`, `REVIEWED`, `REQUESTED_CHANGES`, `APPROVED`, `UNAPPROVED`, `REVIEW_STARTED`.

### Token scopes

Docs: [Access token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/).

- `api`: "Grants complete read and write access to the API for the token's scope." **This is required to create and publish drafts, post notes, and approve.**
- `read_api`: "Grants read access to the API for the token's scope." Enough for the Review Request list (#5) and `diff_refs`, but not for posting.
- `lib/api/draft_notes.rb` also accepts the `ai_workflows` scope (`allow_access_with_scope :ai_workflows`), and declares per-route fine-grained permissions (`create_merge_request_draft_note`, `publish_merge_request_draft_note`, `read_merge_request_draft_note`). Fine-grained PATs could in principle be limited to those permissions. Approving and posting the summary note need their own permissions; these were not checked.
- **Implication for the token option:** a `read_api` token gives a read-only plugin; posting reviews needs `api`. The plugin can check the stored token with `GET /personal_access_tokens/self`, which returns `scopes` (and `granular_scopes` since 19.5). If `api` is missing, it can disable "Post review to GitLab" with a hint. The settings text should say which scope each feature needs.
- glab: the logged-in glab token on gitlab.com could read draft notes (`GET .../draft_notes` → 200 live). Whether it can write depends on the scopes of the token or OAuth grant used at `glab auth login` (not verified here; a PAT created for glab must include `api`). Writes were not tested live, per the rules for this research.

### glab native support

From `glab` 1.119.0 `--help`. All are marked EXPERIMENTAL ("might be unstable or removed at any time").

- `glab mr note create --draft [-m body] [--file <path> [--line <n|start:end> | --old-line <n>]] [--reply <discussion>]`: creates a pending review comment. `--file` "Targets the latest merge request diff version". The plugin cannot pass its own SHAs.
- `glab mr note publish [-m summary] [--internal] [--reviewer-state requested_changes|reviewed] [--yes]`: wraps `bulk_publish`. `--yes` is required when not running interactively. "Neither state records a formal approval; use `glab mr approve`."
- `glab mr approve [--sha <head sha>]`.
- These commands use `-R <full MR/repo URL>` to choose the host. There is no `--hostname` as with `glab api`.
- **Recommendation:** use `glab api --hostname <host>` for every write. That keeps exact SHAs and one code path shared with token mode, and avoids depending on experimental commands. `glab api` sends a JSON body with `--input <file|->` plus `-H 'Content-Type: application/json'`. Nested `position[...]` can also be sent as form fields, but JSON is cleaner.

## Open points (for the build tickets)

- Whether the Orca diff view's comment lines map 1:1 onto GitLab's `base_sha..head_sha` diff. This depends on how Orca computes its diff (merge base vs target tip).
- Live end-to-end test on a throwaway MR in a personal sandbox project before shipping, to confirm `bulk_publish`, the quick-action path on a pre-19.2 instance, and partial-failure behavior.
