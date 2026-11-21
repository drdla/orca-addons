# Orca Add-ons

Plugins that extend the Orca desktop app. Code Review Requests surfaces GitLab merge request reviews that are waiting on the user; Linear Board Sync keeps Orca's workspace board in step with Linear; Worktree Kit Sync copies gitignored local files (agent config, `.env` files) into every new worktree.

## Language

**Review Request**:
An open, non-draft GitLab merge request on which the user is listed as a Reviewer and has not yet approved.
_Avoid_: review, MR review, pending review, assigned MR

**Ended Review Request**:
A merge request that was a Review Request and no longer is, because the user approved it, it was merged or closed, or the user was removed as Reviewer. A merge request made draft drops off the list but is not an Ended Review Request.
_Avoid_: finished review, closed review, stale review

**Overdue Review Request**:
A Review Request that has waited longer than the overdue threshold (default 24 hours, counting working days Mon–Fri only) since the user was added as Reviewer.
_Avoid_: late review, stale review, SLA breach

**Review Workspace**:
An Orca workspace linked to the merge request of a Review Request. A Review Workspace is also a Linked Workspace when its branch names a Linear ticket.
_Avoid_: MR worktree, review branch

**Review Cover Page**:
A read-only Markdown snapshot of a Review Workspace's merge request (title, description, metadata, changed-file list), opened in Orca's main view. It is built once from GitLab: when the review starts, or when the workspace is first opened without one. It records the commit checked out in the workspace and is not rebuilt on open.
_Avoid_: MR summary, overview page, readme

**Review Prompt**:
The predefined, placeholder-bearing prompt that starts an Agent Review.
_Avoid_: review template, system prompt

**Agent Review**:
An agent run inside a Review Workspace, started with the Review Prompt.
_Avoid_: pre-review, AI review, auto-review

**Review Draft**:
The Review Comments, optional summary and review state that the user prepares in Orca for one Review Request and posts to GitLab as a single review.
_Avoid_: pending review, batch, review bundle

**Review Comment**:
One comment in a Review Draft, coming from either an Orca diff-view note or a kept Agent Finding, attached to a line or posted as a general comment.
_Avoid_: note, draft note, finding

**Agent Finding**:
An issue an Agent Review reports, before the user has kept it as a Review Comment or dropped it.
_Avoid_: AI comment, suggestion

**Forge**:
The code-hosting service a plugin reads data from (here, GitLab, either gitlab.com or a self-hosted instance), as distinct from where the plugin's own source lives (GitHub).
_Avoid_: host, remote, provider

### Linear Board Sync

**Linked Workspace**:
An Orca workspace tied to one Linear ticket: by Orca's own Linear link first, otherwise by an issue identifier (`<team key>-<number>`, any case) in its branch name. A workspace with neither is not a Linked Workspace and the plugin never touches it.
_Avoid_: ticket workspace, linked worktree, synced workspace

**Board Column**:
A column of Orca's workspace board, named by its id (`todo`, `in-progress`, `in-review`, `completed` built in; a custom column's id is the slug of its label at creation). Orca's CLI calls it the workspace status.
_Avoid_: status, lane, workspace status

**State Mapping**:
The rule that turns a Linear ticket's state into a Board Column: a team-scoped override by state name (`"OEO/Review"`), then an unscoped one (`"Review"`), then the default by state type (triage, backlog, unstarted → `todo`; started → `in-progress`; completed, canceled → `completed`).
_Avoid_: column mapping, status map

**Writable Column**:
A Board Column whose drag the plugin writes back to Linear as a set state (by default Todo, In Progress, Blocked). A drag into any other column is reverted, because GitLab or the PO own those states.
_Avoid_: editable column, two-way column

**Start**:
Creating a workspace for, or dragging into In Progress, a ticket that is not started yet and is assigned to the user or unassigned: the ticket goes to In Progress in Linear (and, if unassigned, to the user).
_Avoid_: pick up, claim, begin
