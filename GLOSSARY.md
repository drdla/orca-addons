# Orca Add-ons

Plugins that extend the Orca desktop app. The first one surfaces GitLab merge request reviews that are waiting on the user.

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
An Orca workspace linked to the merge request of a Review Request.
_Avoid_: MR worktree, review branch

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
