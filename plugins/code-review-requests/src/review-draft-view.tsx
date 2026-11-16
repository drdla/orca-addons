// The Review Draft drill-in view (#29). "Review draft" on an In review card opens it in place of
// the tabs; Back returns. Opening (and Import again) asks the worker to import the diff-view
// notes and Agent Findings (`rr.draft`). Diff-view notes are read-only here (edit them in Orca);
// Agent Findings get an editor. Every comment has a checkbox: checked ones are what #30 posts.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Checkbox,
  Heading,
  IconButton,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Spinner,
  Stack,
  Text,
  Textarea,
  update
} from 'orca'
import type { ReviewCommentView, ReviewDraftView } from './protocol'
import { openConfirm, PostSection, resetPosting, setupPosting } from './review-post-view'
import { messageOf } from './errors'

/** The Review Request whose draft is open (its MR URL), or null for the tabs. Kept across reloads. */
const draftUrl = atom<string | null>('rr.draftUrl', null, { persist: 'plugin' })
/** The worker's last answer for the open draft. */
const draft = atom<ReviewDraftView | null>(null)
const draftFailure = atom<string | null>(null)
const importing = atom(false)
/** Unsaved Agent Finding text, by comment id. */
const edits = atom<Record<string, string>>({})
/** Per-comment errors, by comment id. */
const commentErrors = atom<Record<string, string>>({})

/** Is a Review Draft open (the panel shows it instead of the tabs)? */
export function isReviewDraftOpen(): boolean {
  return read(draftUrl) !== null
}

/** For the panel's setup: reload the draft that was open before a reload. */
export function setupReviewDraft(): void {
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
  plugin
    .request('rr.draft', { url }, { timeoutMs: 60_000 })
    .then((answer) => {
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
  const busy = read(importing)
  const checked = current?.comments.filter((c) => c.checked).length ?? 0
  return (
    <Stack gap="md">
      <Row justify="between">
        <Row gap="sm">
          <Button size="xs" variant="ghost" onPress={closeReviewDraft}>
            Back
          </Button>
          <Heading level={2}>Review Draft</Heading>
        </Row>
        <Row gap="sm">
          {busy && <Spinner label="Importing" labelHidden />}
          <IconButton icon="refresh" label="Import again" variant="ghost" size="sm" disabled={busy} onPress={importDraft} />
        </Row>
      </Row>
      {failure !== null && (
        <Callout tone="warning" icon="warning" title="Can't load the Review Draft">
          {failure}
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
          <Section
            title="Diff-view notes"
            empty="No diff-view notes. Add them in Orca's diff view, then import again."
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
        {comment.posted && <Badge tone="success">Posted</Badge>}
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
