// The Review Draft drill-in view (#29). "Review draft" on an In review card opens it in place of
// the tabs; ← Back returns. Opening asks the worker to import the diff-view notes and Agent
// Findings (`rr.draft`), and so does every AUTO_IMPORT_MS while the panel is visible, and coming
// back into view: notes added in Orca's diff view show up without a button. Diff-view notes are
// read-only here (edit them in Orca); Agent Findings get an editor. Every comment has a checkbox:
// checked ones are what #30 posts.
// After the workspace moved to newer commits (#58), comments on changed lines say "May be
// outdated" and Agent Findings for an older commit "Stale"; both stay curatable.
import {
  atom,
  Badge,
  Box,
  Callout,
  Checkbox,
  Heading,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Stack,
  Text,
  Textarea,
  update,
  type PanelContext
} from 'orca'
import { Button } from './button'
import { BackButton } from './back-button'
import type { ReviewCommentView, ReviewDraftView } from './protocol'
import { isPostingNow, openConfirm, PostSection, resetPosting, setupPosting } from './review-post-view'
import { messageOf } from './errors'
import { plural } from './plural'

/** The Review Request whose draft is open (its MR URL), or null for the tabs. Kept across reloads. */
const draftUrl = atom<string | null>('rr.draftUrl', null, { persist: 'plugin' })
/** The worker's last answer for the open draft. */
const draft = atom<ReviewDraftView | null>(null)
const draftFailure = atom<string | null>(null)
const importing = atom(false)
/** When the last import started (ms). */
let lastImportAt = 0
/** Unsaved Agent Finding text, by comment id. */
const edits = atom<Record<string, string>>({})
/** Per-comment errors, by comment id. */
const commentErrors = atom<Record<string, string>>({})

/** Is a Review Draft open (the panel shows it instead of the tabs)? */
export function isReviewDraftOpen(): boolean {
  return read(draftUrl) !== null
}

/** How often an open, visible Review Draft imports again. */
export const AUTO_IMPORT_MS = 10_000
/** How often the panel looks whether it came back into view. */
export const VISIBILITY_CHECK_MS = 1_000

/**
 * For the panel's setup: the automatic re-import, and reloading the draft that was open before a
 * reload. Imports are local (Orca's diff-view notes, the findings file, git), never GitLab.
 */
export function setupReviewDraft(ctx: PanelContext): void {
  let wasVisible = read(ctx.visible)
  const timer = setInterval(() => {
    const visible = read(ctx.visible)
    const cameBack = visible && !wasVisible
    wasVisible = visible
    if (!visible || read(draftUrl) === null || read(importing) || isPostingNow()) return
    if (cameBack || Date.now() - lastImportAt >= AUTO_IMPORT_MS) importDraft()
  }, VISIBILITY_CHECK_MS)
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) })
  if (read(draftUrl) === null) return
  setupPosting()
  importDraft()
}

export function openReviewDraft(url: string): void {
  set(draftUrl, url)
  set(draft, null)
  set(edits, {})
  set(commentErrors, {})
  resetPosting()
  importDraft()
}

/** A card's "Post N to GitLab" (#10): the Review Draft, opened at its confirm step. */
export function openReviewDraftToPost(url: string): void {
  openReviewDraft(url)
  openConfirm(url)
}

function closeReviewDraft(): void {
  resetPosting()
  set(draftUrl, null)
  set(draft, null)
  set(draftFailure, null)
}

function importDraft(): void {
  const url = read(draftUrl)
  if (url === null) return
  set(importing, true)
  lastImportAt = Date.now()
  plugin
    .request('rr.draft', { url }, { timeoutMs: 60_000 })
    .then((answer) => {
      // The draft closed or another one opened meanwhile: this answer is for nobody.
      if (read(draftUrl) !== url) return
      set(draft, answer)
      set(draftFailure, null)
    })
    .catch((error: unknown) => set(draftFailure, messageOf(error)))
    .finally(() => set(importing, false))
}

function setCommentError(id: string, message: string | null): void {
  update(commentErrors, (all) => {
    const next = { ...all }
    if (message === null) delete next[id]
    else next[id] = message
    return next
  })
}

function changeComment(id: string, change: { checked?: boolean; body?: string }): void {
  const url = read(draftUrl)
  if (url === null) return
  setCommentError(id, null)
  plugin
    .request('rr.updateDraftComment', { url, id, ...change })
    .then((answer) => {
      set(draft, answer)
      if (change.body !== undefined) {
        update(edits, (all) => {
          const next = { ...all }
          delete next[id]
          return next
        })
      }
    })
    .catch((error: unknown) => setCommentError(id, messageOf(error)))
}

function setEdit(id: string, text: string): void {
  update(edits, (all) => ({ ...all, [id]: text }))
}

/** `src/a.ts:8–10`, `src/a.ts:10`, or "General comment". */
function locationOf(comment: ReviewCommentView): string {
  if (comment.filePath === null) return 'General comment'
  if (comment.line === null) return comment.filePath
  const lines = comment.startLine === undefined ? `${comment.line}` : `${comment.startLine}–${comment.line}`
  return `${comment.filePath}:${lines}`
}

export function ReviewDraftScreen() {
  const current = read(draft)
  const failure = read(draftFailure)
  const checked = current?.comments.filter((c) => c.checked).length ?? 0
  return (
    <Stack gap="md">
      <Row gap="sm">
        <BackButton onPress={closeReviewDraft} />
        <Heading level={2}>Review Draft</Heading>
      </Row>
      {failure !== null && (
        <Callout tone="warning" icon="warning" title="Can't load the Review Draft">
          <Stack gap="sm">
            <Text size="sm">{failure}</Text>
            <Row>
              <Button size="xs" variant="ghost" disabled={read(importing)} onPress={importDraft}>
                Try Again
              </Button>
            </Row>
          </Stack>
        </Callout>
      )}
      {current === null ? (
        failure === null && <Skeleton lines={4} label="Loading the Review Draft" />
      ) : (
        <Stack gap="md">
          <Stack gap="xs">
            <Text weight="semibold">{current.title}</Text>
            <Text muted size="xs">{`${checked} of ${current.comments.length} checked`}</Text>
          </Stack>
          <PostSection draft={current} onDraft={(answer) => set(draft, answer)} />
          {current.warnings.length > 0 && (
            <Callout tone="warning" icon="warning" title="Some things were not imported">
              <Stack gap="xs">
                {current.warnings.map((warning) => (
                  <Text key={warning} size="sm">
                    {warning}
                  </Text>
                ))}
              </Stack>
            </Callout>
          )}
          <MovedOn comments={current.comments} />
          <Section
            title="Diff-view notes"
            empty="No diff-view notes. Add them in Orca's diff view; they show up here."
            comments={current.comments.filter((c) => c.origin === 'diff-note')}
          />
          <Section
            title="Agent Findings"
            empty="No Agent Findings yet. Run an Agent Review, then import again."
            comments={current.comments.filter((c) => c.origin === 'agent-finding')}
          />
        </Stack>
      )}
    </Stack>
  )
}

/** After the Review Workspace moved to newer commits (#58): what that means for the draft. */
function MovedOn({ comments }: { comments: ReviewCommentView[] }) {
  const outdated = comments.filter((c) => c.outdated === true).length
  const stale = comments.filter((c) => c.stale === true).length
  if (outdated === 0 && stale === 0) return null
  return (
    <Callout tone="neutral" icon="info" title="The Review Workspace has moved on">
      <Stack gap="xs">
        {outdated > 0 && (
          <Text size="sm">
            {outdated === 1
              ? `${plural(1, 'Review Comment')} may be outdated: its lines changed since it was written. Check it, then keep, edit or drop it.`
              : `${plural(outdated, 'Review Comment')} may be outdated: their lines changed since they were written. Check them, then keep, edit or drop them.`}
          </Text>
        )}
        {stale > 0 && (
          <Text size="sm">
            {`${plural(stale, 'Agent Finding')} ${stale === 1 ? 'is' : 'are'} from an older commit: ` +
              'run Agent Review for fresh ones, then import again.'}
          </Text>
        )}
      </Stack>
    </Callout>
  )
}

function Section({ title, empty, comments }: { title: string; empty: string; comments: ReviewCommentView[] }) {
  return (
    <Stack gap="sm">
      <Heading level={3}>{title}</Heading>
      {comments.length === 0 ? (
        <Text muted size="sm">
          {empty}
        </Text>
      ) : (
        comments.map((c) => <CommentCard key={c.id} comment={c} />)
      )}
    </Stack>
  )
}

function CommentCard({ comment }: { comment: ReviewCommentView }) {
  const error = read(commentErrors)[comment.id]
  const edit = read(edits)[comment.id]
  const text = edit ?? comment.body
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="start">
        <Checkbox
          label={locationOf(comment)}
          checked={comment.checked}
          disabled={comment.posted}
          onChange={(checked) => changeComment(comment.id, { checked })}
        />
        <Row gap="xs">
          {comment.outdated === true && <Badge tone="warning">May be outdated</Badge>}
          {comment.stale === true && <Badge tone="neutral">Stale</Badge>}
          {comment.posted && <Badge tone="success">Posted</Badge>}
        </Row>
      </Row>
      {comment.editable ? (
        <Stack gap="xs">
          <Textarea
            label="Agent Finding"
            labelHidden
            rows={3}
            value={text}
            onChange={(value) => setEdit(comment.id, value)}
            onSubmit={(value) => changeComment(comment.id, { body: value })}
          />
          {edit !== undefined && edit !== comment.body && (
            <Row gap="xs">
              <Button size="xs" onPress={() => changeComment(comment.id, { body: edit })}>
                Save
              </Button>
            </Row>
          )}
        </Stack>
      ) : (
        <Stack gap="xs">
          <Text size="sm">{comment.body}</Text>
          {comment.origin === 'diff-note' && !comment.posted && (
            <Text muted size="xs">
              Edit it in Orca's diff view.
            </Text>
          )}
        </Stack>
      )}
      {comment.failure !== undefined && (
        <Text tone="danger" size="xs">
          {`Not posted: ${comment.failure}`}
        </Text>
      )}
      {error !== undefined && (
        <Text tone="danger" size="xs">
          {error}
        </Text>
      )}
    </Box>
  )
}
