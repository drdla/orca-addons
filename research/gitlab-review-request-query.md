# Which GitLab query lists my Review Requests?

Research for [#5](https://github.com/drdla/orca-addons/issues/5) (map [#1](https://github.com/drdla/orca-addons/issues/1)).
A **Review Request** is an open, non-draft merge request (MR) where the user is a Reviewer and has not yet approved it.

Researched 2026-11-16 against gitlab.com (`GET /version` reported `19.6.0-pre`) and `glab` 1.119.0.
Live checks were read-only calls made with `glab api` as a logged-in user. This file records only response shapes and counts, never private data.

## Answer in one screen

Use **GraphQL** `currentUser.reviewRequestedMergeRequests`. One request returns the whole list, a cheap count, and the user's own review and approval state on each MR.

```graphql
query ReviewRequests($me: String!, $after: String) {
  currentUser {
    username
    reviewRequestedMergeRequests(
      state: opened
      draft: false
      not: { approvedBy: [$me] }        # GitLab 17.4+; see "Older instances"
      sort: UPDATED_DESC
      first: 100                        # max page size
      after: $after
    ) {
      count                             # for the status bar
      pageInfo { hasNextPage endCursor }
      nodes {
        id iid title webUrl draft state createdAt updatedAt
        sourceBranch targetBranch
        project { fullPath group { fullPath } }
        author { username name }
        labels { nodes { title } }
        reviewers { nodes { username mergeRequestInteraction { reviewState approved reviewed } } }
      }
    }
  }
}
```

- With glab: `glab api graphql --hostname <host> -f query="$QUERY" -f me=<username>`. Every field other than `query` and `operationName` becomes a GraphQL variable. With `--paginate`, glab follows `$endCursor` itself, but the query must then declare `$endCursor: String` instead of `$after`.
- With a token: `POST https://<host>/api/graphql` with header `Authorization: Bearer <PAT>` and JSON body `{"query": …, "variables": {…}}`. The token needs the **`read_api`** scope.
- Get `$me` once from `currentUser { username }`, or from REST `GET /user`.

## Evidence

### GraphQL: `currentUser.reviewRequestedMergeRequests`

- Field description: "Merge requests assigned to the user for review." The resolver (`app/graphql/resolvers/review_requested_merge_requests_resolver.rb`) sets `user_role :reviewer`. So the base set is MRs where the current user is in `merge_request_reviewers`. Source: gitlab-org/gitlab `master`.
- GitLab's own MR dashboard calls the same field (`app/assets/javascripts/merge_request_dashboard/queries/reviewer.query.graphql`, `reviewer_count.query.graphql`) with `state`, `reviewState(s)`, `not`, `or`, `first/after`, and `sort: UPDATED_DESC`. For the badge it requests only `count`.
- Arguments, from live introspection of gitlab.com. Only the ones the plugin can use are listed:
  - `state: MergeRequestState` (`opened`, `closed`, `locked`, `merged`, `all`)
  - `draft: Boolean`
  - `reviewState: MergeRequestReviewState` and `reviewStates: [MergeRequestReviewState!]`
  - `approvedBy: [String!]`
  - `not: MergeRequestsResolverNegatedParams`. Its schema description reads: "Warning: this argument is experimental and a subject to change in future."
  - `groupId: GroupID` (includes subgroups), plus `projectPath` / `projectId`. Each takes a single value, and the path and ID forms can't be combined.
  - `authorUsername`, `labelName: [String]` (`labels` is deprecated as of 17.1), `targetBranches`, `sourceBranches`, `milestoneTitle`, `search` and `in`, `createdAfter/Before`, `updatedAfter/Before`, `includeArchived`, `or`
  - `sort: MergeRequestSort` (for example `UPDATED_DESC`, `CREATED_DESC`)
  - pagination: `first`, `last`, `after`, `before`
- `not` (`MergeRequestsResolverNegatedParams`, defined in `app/graphql/types/merge_requests/negated_merge_request_filter_input_type.rb`) accepts these keys:
  - `approvedBy: [String]`
  - `authorUsername: String`
  - `labelName: [String]`
  - `targetBranches: [String]`
  - `sourceBranches: [String]`
  - `assigneeUsernames`
  - `milestoneTitle`
  - `releaseTag`
  - `reviewerUsername`
  - `myReactionEmoji`
  - `reviewStates` (experiment, 17.9)
  - `onlyReviewer` (experiment, 17.11)

  There is **no negated group or project filter**.
- `MergeRequestReviewState` has six values: `UNREVIEWED`, `REVIEWED`, `REQUESTED_CHANGES`, `APPROVED`, `UNAPPROVED`, `REVIEW_STARTED`.
- `UserMergeRequestInteraction` is reachable at `MergeRequest.reviewers.nodes[].mergeRequestInteraction`. Its fields:
  - `approved: Boolean!`: "Whether the user has approved the merge request."
  - `approvedAt`
  - `reviewState`
  - `reviewed: Boolean!`
  - `updatedAt`
  - `canMerge`
  - `canUpdate`
  - `applicableApprovalRules`

### How the filters behave (gitlab-org/gitlab `app/finders/merge_requests_finder.rb`, `app/models/merge_request.rb`)

- `reviewState` and `reviewStates`: these combine with the reviewer, so `by_reviewer` calls `review_requested_to(reviewer, review_state)`. The scope then adds `merge_request_reviewers.user_id = <me> AND state IN (…)`. On `reviewRequestedMergeRequests` these arguments therefore filter on **my own** reviewer row, not on any reviewer.
- `not.reviewStates` calls `no_review_states`. That scope matches MRs where **no** reviewer has those states. It does not look only at my row, so it is the wrong tool here.
- `not.approvedBy` calls `not_approved_by_users_with_usernames`. That scope reads the approvals table, which is the ground truth for "has approved", so it matches the glossary exactly.
- Gotcha: `MergeRequest.approved` means that the MR **has all required approvals**. It says nothing about whether *I* approved. My own state is in `reviewers.nodes[username == me].mergeRequestInteraction.approved`.

### Knowing my own approval state without one call per MR

There are two server-side options. Both come back in the single list request.

1. **Filter the MRs out:** `not: { approvedBy: ["<me>"] }`. This needs GitLab 17.4+, and the `not` argument is labelled experimental.
2. **Read the state per MR:** request `reviewers { nodes { username mergeRequestInteraction { approved reviewState } } }` and pick out my node. This works on all supported versions.

Recommendation: use (1) to filter. Also request (2) and drop any MR where my `approved` is true. That second check protects against changes to the experimental `not` argument, and the panel can show my `reviewState` (for example `REQUESTED_CHANGES`) with no extra call.

### Live check on gitlab.com (shape and counts only)

- In one request, the account showed the same count (7) for four variants:
  - `count` with `state: opened`
  - `count` with `draft: false` added
  - `count` with `not: {approvedBy: [me]}` added
  - `count` with `reviewStates: [UNREVIEWED, REVIEWED, REQUESTED_CHANGES, UNAPPROVED, REVIEW_STARTED]`

  None of those MRs had my approval, so the exclusion itself was not exercised.
- Nodes came back with every requested field. In the sampled nodes, my `mergeRequestInteraction` was `{reviewState: UNREVIEWED, approved: false, reviewed: false}`. At the same time, MR-level `approved` was `true` and `approvalsLeft` was `0`, which confirms the gotcha above.
- `pageInfo.hasNextPage` and `endCursor` worked with `first: 2`.
- Response headers on `POST /api/graphql` included `RateLimit-Limit: 2000`, `RateLimit-Name: throttle_authenticated_api`, and `RateLimit-Remaining`. So GraphQL calls count against the same authenticated API throttle as REST.

### REST alternative (`GET /api/v4/merge_requests`)

Sources: docs.gitlab.com/api/merge_requests, and `lib/api/helpers/merge_requests_helpers.rb` on master.

```
GET /api/v4/merge_requests?scope=reviews_for_me&state=opened&draft=false&order_by=updated_at&per_page=100
# equivalent: scope=all&reviewer_username=<me>
# GitLab < 19.0: use wip=no instead of draft=false (wip is deprecated in 19.0, mutually exclusive with draft)
```

- `scope=reviews_for_me`: "returns merge requests where the current user is assigned as a reviewer."
- Supported filters: `author_username`, `labels`, `target_branch`, `source_branch`, `search`/`in`, `created_*`/`updated_*`, and `approved_by_usernames[]` / `approved_by_ids[]`. The documented `not[...]` keys are only `labels`, `milestone`, `author_id/username`, `assignee_id/username`, `reviewer_id/username`, and `my_reaction_emoji`. **There is no negated `approved_by`**. A live call with `not[approved_by_usernames][]` was not rejected, but it is undocumented, so don't rely on it.
- `reviewers[]` in the response carries `id, username, name, state, locked, avatar_url, public_email, web_url`. Here `state` is the **account** state (`active`, `blocked`, …), not the review state. REST has no per-reviewer review or approval state in the list.
- To get "not approved by me" over REST, make two list calls and subtract: the full list, and the same list with `approved_by_usernames[]=<me>`. Both calls were tested live. The alternative is one `GET /projects/:id/merge_requests/:iid/approvals` per MR.
- Instance-wide REST has no project or group filter. You have to use `/groups/:id/merge_requests` or `/projects/:id/merge_requests` instead.

**Verdict:** GraphQL needs one request where REST needs two or more. It returns my own review state and gives `count` for free. Use REST only as a fallback.

### Filtering and blocklisting

| Need | GraphQL (server-side) | Blocklist (server-side) | Otherwise |
|---|---|---|---|
| Group | `groupId: "gid://gitlab/Group/<id>"` (one, includes subgroups) | – | Client-side on `project.fullPath` / `project.group.fullPath` |
| Project | `projectPath` or `projectId` (one) | – | Client-side on `project.fullPath` |
| Author | `authorUsername` (one) | `not.authorUsername` (one) | Client-side on `author.username` |
| Labels | `labelName: [..]` (all must match) | `not.labelName: [..]` | Client-side on `labels.nodes[].title` |
| Target branch | `targetBranches: [..]` (any) | `not.targetBranches: [..]` | Client-side on `targetBranch` |

The allowlist and blocklist can hold several groups or projects, and GraphQL accepts only one group and one project per call. The plugin should therefore fetch the full list once and filter by path on the client. The list is small, since it only holds MRs where this user is a Reviewer.

### Rate limits, pagination, conditional requests

- **Page size:** GraphQL "default maximum page size for a connection is 100 records". Pagination is cursor-based through `pageInfo { hasNextPage endCursor }`. REST uses `per_page` (max 100) together with the `X-Total`, `X-Next-Page`, and `Link` headers. Source: docs.gitlab.com/api/graphql.
- **GraphQL limits:** query complexity of 250 for authenticated requests, 10,000 characters per query, and a 30 s timeout. The recommended query, run exactly as written above, returned all its nodes (7) without errors. Source: docs.gitlab.com/api/graphql.
- **gitlab.com rate limit:** "Authenticated API traffic for a user is 2,000 requests each minute". The plan-based hourly limits are proposed: Free 5,000/h with a burst of 100/min. A 429 response carries `Retry-After` and `RateLimit-ResetTime`. Every response carries `RateLimit-Limit` and `RateLimit-Remaining`. Source: docs.gitlab.com/user/gitlab_com/rate_limits. At a 5-minute poll this is about 12 requests per hour, which is negligible. Self-hosted limits are set by the admin.
- **Token scope:** `read_api` "Grants read access to the API". GraphQL docs say: "Sufficient for queries". Sources: docs.gitlab.com/security/tokens/access_token_scopes and docs.gitlab.com/api/graphql.
- **ETag / conditional requests:**
  - REST returns weak `ETag`s. A live re-request with `If-None-Match: <etag>` got `304 Not Modified`. **It still decremented `RateLimit-Remaining`**, and the server still runs the query. So a 304 saves bandwidth and parsing, but not quota.
  - GraphQL is `POST` and returned an `Etag` header, but conditional POST is not a documented feature. Polling should not depend on it.
  - The cheap change-detector is the GraphQL `count` combined with the max `updatedAt` from the first page. Sorting by `UPDATED_DESC` puts the newest change first.

### Minimum GitLab version (self-hosted)

Determined by reading the resolver and type files at release tags `vX.Y.0-ee` in gitlab-org/gitlab:

| Feature | Present from |
|---|---|
| `reviewRequestedMergeRequests`, `draft` arg, `reviewers.mergeRequestInteraction { approved reviewState reviewed }` | ≤ 15.11 (oldest tag checked) |
| `reviewState` / `reviewStates` args | 17.0 |
| `labelName` arg | 17.2 |
| `not: { approvedBy }` | 17.4 |
| REST `draft` param (replacing `wip`) | 19.0 |

**Recommended floor: GitLab 17.4** for the query as written.

### Older instances

- **17.0 to 17.3:** replace `not` with `reviewStates: [UNREVIEWED, REVIEWED, REQUESTED_CHANGES, UNAPPROVED, REVIEW_STARTED]`. Not every enum value exists on every version. Introspect `MergeRequestReviewState` and drop the unknown values.
- **Before 17.0:** drop both filters and filter on the client, using my `mergeRequestInteraction.approved`.

A cheap feature probe is `__type(name: "MergeRequestsResolverNegatedParams") { inputFields { name } }`, or a check of `GET /api/v4/version`.

### How `glab` picks a host

Sources: gitlab-org/cli `internal/config/schema.go` (`host` key), `docs/source/connection.md`, and `docs/source/api/_index.md`.

- `glab api --hostname <host>` overrides the host for that call.
- Without the flag, glab picks in this order:
  1. An environment variable `GITLAB_HOST`, `GITLAB_URI`, or `GL_HOST`. The schema says one of these "always wins".
  2. Inside a Git repository, the GitLab host of the current directory's remote. This takes precedence over the config key.
  3. The global `host` config key, set with `glab config set -g host <host>`. Its default is `gitlab.com`.
- `GITLAB_TOKEN` (also `GITLAB_ACCESS_TOKEN`, `OAUTH_TOKEN`) overrides the stored token. The token is sent only to the host named by `GITLAB_HOST` or to hosts listed in the config file.
- **For the plugin:**
  - Always pass `--hostname <configured instance host>`, so that the result does not depend on the worker's working directory or environment.
  - Use `glab auth status --hostname <host>` to detect that glab is missing or logged out.
  - In token mode, call `https://<host>/api/graphql` directly with `Authorization: Bearer <PAT>` (`read_api`).
