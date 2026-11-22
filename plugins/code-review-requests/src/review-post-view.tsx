// Posting a Review Draft from its drill-in view (#30): the outcome, a summary and Post Review. Post
// Review asks GitLab first; warnings or my other GitLab drafts that would publish too show above the
// button (Post Anyway / Cancel). Then it shows what happened: posted, partly failed (Retry / Delete
// failed drafts), or refused. Gated on
// the connection's canPost: false disables it with the api-scope hint; null (unknown) allows it,
// and the worker turns a 403 into the same hint.
import {
  atom,
  Callout,
  plugin,
  RadioGroup,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  Textarea,
} from 'orca'
import { Button } from './button'
import { canPostReviews } from './connection-section'
import type { PostPreview, PostResult, ReviewDraftView, ReviewOutcome } from './protocol'
import { messageOf } from './errors'
import { plural } from './plural'

export type PostStep =
  | { kind: 'idle' }
  | { kind: 'loading' }
  /** `postingSince`: when posting started (ms), while the worker posts; else null. */
  | { kind: 'confirm'; preview: PostPreview; postingSince: number | null }
  | { kind: 'done'; result: Omit<PostResult, 'draft'> }

/** The post request's timeout: a "posting" step older than this lost its answer (a reload). */
const POST_TIMEOUT_MS = 120_000

// Persisted (plugin scope) so the warnings and the result survive a panel reload, and so
// `orca plugin check` scenarios can show each step.
const step = atom<PostStep>('rr.postStep', { kind: 'idle' }, { persist: 'plugin' })
const summary = atom('rr.postSummary', '', { persist: 'plugin' })
const outcome = atom<ReviewOutcome>('rr.postOutcome', 'comment', { persist: 'plugin' })
/** Why checking, posting or deleting failed drafts didn't work. */
const failure = atom<string | null>(null)
const deleting = atom(false)

const OUTCOMES: { value: ReviewOutcome; label: string }[] = [
  { value: 'comment', label: 'Comment' },
  { value: 'requested_changes', label: 'Request changes' },
  { value: 'approve', label: 'Approve' }
]

/** Where Review Drafts post to: the only source so far. */
export const PROVIDER = 'GitLab'

export const API_SCOPE_HINT = 'Posting a review needs a token with the api scope.'

/** A fresh form (opening or leaving a Review Draft). */
export function resetPosting(): void {
  set(step, { kind: 'idle' })
  set(summary, '')
  set(outcome, 'comment')
  set(failure, null)
}

/** Still waiting for the worker's answer? Past the request timeout the answer is lost (a reload). */
function isPosting(current: PostStep): boolean {
  return current.kind === 'confirm' && current.postingSince !== null && Date.now() - current.postingSince < POST_TIMEOUT_MS
}

/** Is a post under way for the open Review Draft? The automatic re-import waits for it. */
export function isPostingNow(): boolean {
  return isPosting(read(step))
}

/**
 * For the panel's setup: a step whose request was lost with the last panel goes back to Post
 * Review (the re-import shows what got posted). A post still within its timeout shows as posting
 * until the timeout has passed (isPosting), then the confirm step unlocks.
 */
export function setupPosting(): void {
  const current = read(step)
  if (current.kind === 'loading') set(step, { kind: 'idle' })
  if (current.kind === 'confirm' && current.postingSince !== null && !isPosting(current)) set(step, { kind: 'idle' })
}

/**
 * Post Review: asks GitLab what the post would publish. With nothing to warn about it posts right
 * away; otherwise the warnings show above the button, which becomes Post Anyway.
 */
function startPost(draft: ReviewDraftView, onDraft: (draft: ReviewDraftView) => void): void {
  set(step, { kind: 'loading' })
  set(failure, null)
  plugin
    .request('rr.postPreview', { url: draft.url }, { timeoutMs: 60_000 })
    .then((preview) => {
      if (preview.warnings.length === 0 && preview.leftoverDrafts.length === 0) post(preview, onDraft)
      else set(step, { kind: 'confirm', preview, postingSince: null })
    })
    .catch((error: unknown) => {
      set(step, { kind: 'idle' })
      set(failure, messageOf(error))
    })
}

function post(preview: PostPreview, onDraft: (draft: ReviewDraftView) => void): void {
  set(step, { kind: 'confirm', preview, postingSince: Date.now() })
  set(failure, null)
  plugin
    .request('rr.postReview', { url: preview.url, summary: read(summary), outcome: read(outcome) }, { timeoutMs: POST_TIMEOUT_MS })
    .then(({ draft, ...result }) => {
      onDraft(draft)
      set(step, { kind: 'done', result })
      if (result.failed.length === 0) {
        set(summary, '')
        set(outcome, 'comment')
      }
    })
    .catch((error: unknown) => {
      set(step, { kind: 'idle' })
      set(failure, messageOf(error))
    })
}

function deleteFailedDrafts(url: string, onDraft: (draft: ReviewDraftView) => void): void {
  set(deleting, true)
  set(failure, null)
  plugin
    .request('rr.deleteFailedDrafts', { url }, { timeoutMs: 60_000 })
    .then((draft) => {
      onDraft(draft)
      set(step, { kind: 'idle' })
    })
    .catch((error: unknown) => set(failure, messageOf(error)))
    .finally(() => set(deleting, false))
}

/** The outcome, the summary and Post Review for the open Review Draft, and what posting did. */
export function PostSection(props: { draft: ReviewDraftView; onDraft: (draft: ReviewDraftView) => void }) {
  const { draft, onDraft } = props
  const current = read(step)
  const error = read(failure)
  const posting = isPosting(current)
  const busy = posting || current.kind === 'loading'
  const confirming = current.kind === 'confirm' && !posting
  const unposted = draft.comments.filter((c) => c.checked && !c.posted).length
  const nothingToPost = unposted === 0 && read(summary).trim() === '' && read(outcome) === 'comment'
  const blocked = canPostReviews() === false
  return (
    <Stack gap="sm">
      {current.kind === 'done' && <Outcome result={current.result} draft={draft} onDraft={onDraft} />}
      <RadioGroup
        label="Outcome"
        orientation="horizontal"
        options={OUTCOMES}
        value={read(outcome)}
        disabled={busy}
        onChange={(value) => set(outcome, value as ReviewOutcome)}
      />
      <Textarea
        label="Summary"
        rows={3}
        placeholder="Optional: a note on the whole review"
        value={read(summary)}
        disabled={busy}
        onChange={(value) => set(summary, value)}
      />
      {current.kind === 'confirm' && <Warnings preview={current.preview} />}
      <Row gap="sm">
        {current.kind === 'confirm' && confirming ? (
          <Button icon="upload" onPress={() => post(current.preview, onDraft)}>
            Post Anyway
          </Button>
        ) : (
          <Button icon="upload" disabled={blocked || nothingToPost || busy} onPress={() => startPost(draft, onDraft)}>
            Post Review
          </Button>
        )}
        {confirming && (
          <Button variant="ghost" onPress={() => set(step, { kind: 'idle' })}>
            Cancel
          </Button>
        )}
        {current.kind === 'loading' && <Spinner label="Checking GitLab" labelHidden />}
        {posting && <Spinner label="Posting" labelHidden />}
      </Row>
      {blocked && (
        <Text muted size="xs">
          {API_SCOPE_HINT}
        </Text>
      )}
      {error !== null && (
        <Callout tone="danger" icon="error" title="Couldn't post the Review Draft">
          {error}
        </Callout>
      )}
    </Stack>
  )
}

/** What GitLab said before posting: warnings, and my other GitLab drafts that publish too. */
function Warnings(props: { preview: PostPreview }) {
  const { preview } = props
  if (preview.warnings.length === 0 && preview.leftoverDrafts.length === 0) return null
  return (
    <Stack gap="sm">
      {preview.warnings.length > 0 && (
        <Callout tone="warning" icon="warning" title="Before you post">
          <Stack gap="xs">
            {preview.warnings.map((w) => (
              <Text key={w} size="sm">
                {w}
              </Text>
            ))}
          </Stack>
        </Callout>
      )}
      {preview.leftoverDrafts.length > 0 && (
        <Callout tone="neutral" icon="info" title="Your other GitLab drafts on this MR publish too">
          <Stack gap="xs">
            {preview.leftoverDrafts.map((d) => (
              <Text key={d.id} size="sm">
                {d.body}
              </Text>
            ))}
            <Text muted size="xs">
              Cancel and handle them on GitLab if they shouldn't be part of this review.
            </Text>
          </Stack>
        </Callout>
      )}
    </Stack>
  )
}

function Outcome(props: { result: Omit<PostResult, 'draft'>; draft: ReviewDraftView; onDraft: (draft: ReviewDraftView) => void }) {
  const { result } = props
  return (
    <Stack gap="sm">
      {result.failed.length === 0 ? (
        <Callout tone="success" icon="check" title="Review posted">
          <Stack gap="xs">
            <Text size="sm">{`${plural(result.posted, 'Review Comment')} posted to GitLab.`}</Text>
            {result.posted > 0 && (
              <Text muted size="xs">
                Clear the posted notes in Orca's diff view: the plugin can't delete them.
              </Text>
            )}
          </Stack>
        </Callout>
      ) : (
        <Callout tone="warning" icon="warning" title={`${plural(result.failed.length, 'Review Comment')} couldn't be posted`}>
          <Stack gap="xs">
            {result.posted > 0 && <Text size="sm">{`${plural(result.posted, 'Review Comment')} posted.`}</Text>}
            {result.failed.map((f) => (
              <Text key={f.commentId} size="sm">
                {`${f.location}: ${f.message}`}
              </Text>
            ))}
            <Text muted size="xs">
              They stay in the Review Draft, and GitLab keeps their drafts. Retry replaces those drafts.
            </Text>
            <Row gap="sm">
              <Button size="xs" icon="refresh" onPress={() => startPost(props.draft, props.onDraft)}>
                Retry
              </Button>
              <Button
                size="xs"
                variant="ghost"
                tone="danger"
                icon="delete"
                disabled={read(deleting)}
                onPress={() => deleteFailedDrafts(props.draft.url, props.onDraft)}
              >
                Delete failed drafts
              </Button>
            </Row>
          </Stack>
        </Callout>
      )}
      {result.approveError !== null && (
        <Callout tone="warning" icon="warning" title="Not approved">
          {result.approveError}
        </Callout>
      )}
    </Stack>
  )
}
