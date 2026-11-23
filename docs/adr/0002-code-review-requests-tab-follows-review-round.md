# 2. Code Review Requests: the tab follows the review round, not the workspace

Date: 2026-11-23
Status: Accepted

## Context

The Code Review Requests panel sorts Review Requests into Todo, Reviewing and Done. Until now a Review Request was under Reviewing exactly when it had a Review Workspace, and under Todo when it had none. That was enough while a review only ever ended (approved, merged, closed, removed as Reviewer).

GitLab lets the author re-request a review. Re-requesting removes the reviewer's approval and resets their reviewer state to `UNREVIEWED` (GitLab 16.10/16.11+, every tier), and it works after an approval, a request for changes or a comment-only review. The user wants a re-requested review back under Todo. Its old Review Workspace is usually still there (a Done entry keeps it until it's removed), so "has a workspace" would put it under Reviewing.

Requesting changes now ends a Review Request just as approving does (#78), so most re-requested reviews come back from Done.

## Decision

- **The tab follows the review round.** A Review Request is under Reviewing when it has a Review Workspace **and** the user is reviewing it this round. A Re-requested Review Request is under Todo, with its old workspace still attached.
- **The plugin remembers the user's last outcome per merge request** (approved, changes requested, commented) in plugin storage, with or without a workspace. A Review Request that awaits the user (`UNREVIEWED`) after such an outcome is re-requested. GitLab doesn't say "re-requested" itself: the note for a re-request looks the same as for a first request.
- **Start review begins the new round.** On a re-requested card it reuses the old workspace, moves it to the merge request's new commits first (as Update workspace does, refusing while that would lose changes), and then forgets the last outcome.
- **The memory is forgotten** once the merge request is merged or closed, the user is removed as Reviewer, or it is no longer visible. An approved merge request is off the list, so the plugin looks remembered ones up again, at most once an hour each.
- **The overdue clock is unchanged**: it counts from when the user was first added as Reviewer.

## Consequences

- One rule covers all three outcomes: a re-request always means Todo, and the card says what the user did before.
- Which tab a card is in now depends on plugin state as well as on GitLab and Orca. That state is small (one entry per merge request the user finished reviewing), kept across restarts, and wrong only in a harmless way: a lost entry means a re-requested review shows as an ordinary Todo card, or under Reviewing if its workspace still exists.
- The lookup of finished merge requests costs one small GraphQL query per remembered merge request per hour, only while that merge request is off the list.
