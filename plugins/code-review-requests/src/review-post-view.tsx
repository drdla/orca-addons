// Posting a Review Draft from its drill-in view (#30): "Post N to GitLab" opens a confirm step
// (what posts, my other GitLab drafts that publish too, warnings, a summary and the outcome), then
// shows what happened: posted, partly failed (Retry / Delete failed drafts), or refused. Gated on
// the connection's canPost: false disables it with the api-scope hint; null (unknown) allows it,
// and the worker turns a 403 into the same hint.
import {
  atom,
  Box,
  Button,
  Callout,
  Heading,
  plugin,
  read,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Text,
  Textarea
} from 'orca'
import { canPostReviews } from './connection-section'
import type { PostPreview, PostResult, ReviewDraftView, ReviewOutcome } from './protocol'
import { messageOf } from './errors'
import { plural } from './plural'

export type PostStep =
  | { kind: 'idle' }
  | { kind: 'loading' }
  /** `postingSince`: when Post review was pressed (ms), while the worker posts; else null. */
  | { kind: 'confirm'; preview: PostPreview; postingSince: number | null }
  | { kind: 'done'; result: Omit<PostResult, 'draft'> }

/** The post request's timeout: a "posting" step older than this lost its answer (a reload). */
const POST_TIMEOUT_MS = 120_000

// Persisted (plugin scope) so the confirm step and its result survive a panel reload, and so
// `orca plugin check` scenarios can show each step.
const step = atom<PostStep>('rr.postStep', { kind: 'idle' }, { persist: 'plugin' })
const summary = atom('rr.postSummary', '', { persist: 'plugin' })
const outcome = atom<ReviewOutcome>('rr.postOutcome', 'comment', { persist: 'plugin' })
/** Why loading the confirm step, posting or deleting failed drafts didn't work. */
const failure = atom<string | null>(null)
const deleting = atom(false)

const OUTCOMES: { value: ReviewOutcome; label: string }[] = [
  { value: 'comment', label: 'Comment' },
  { value: 'requested_changes', label: 'Request changes' },
  { value: 'approve', label: 'Approve' }
]

export const API_SCOPE_HINT = 'Posting a review needs a token with the api scope.'

/** Back to the Post button (opening or leaving a Review Draft). */
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

/**
 * For the panel's setup: a step whose request was lost with the last panel goes back to the Post
 * button (the re-import shows what got posted). A post still within its timeout shows as posting
 * until the timeout has passed (isPosting), then the confirm step unlocks.
 */
export function setupPosting(): void {
  const current = read(step)
  if (current.kind === 'loading') set(step, { kind: 'idle' })
  if (current.kind === 'confirm' && current.postingSince !== null && !isPosting(current)) set(step, { kind: 'idle' })
}

/** Opens the confirm step for a Review Draft (also from a card's "Post N to GitLab", #10). */
export function openConfirm(url: string): void {
  set(step, { kind: 'loading' })
  set(failure, null)
  plugin
    .request('rr.postPreview', { url }, { timeoutMs: 60_000 })
    .then((preview) => set(step, { kind: 'confirm', preview, postingSince: null }))
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
      set(step, { kind: 'confirm', preview, postingSince: null })
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

/** The Post button, the confirm step, or what posting did, for the open Review Draft. */
export function PostSection(props: { draft: ReviewDraftView; onDraft: (draft: ReviewDraftView) => void }) {
  const { draft, onDraft } = props
  const current = read(step)
  const error = read(failure)
  const unposted = draft.comments.filter((c) => c.checked && !c.posted).length
  const blocked = canPostReviews() === false
  return (
    <Stack gap="sm">
      {current.kind === 'done' && <Outcome result={current.result} url={draft.url} onDraft={onDraft} />}
      {(current.kind === 'idle' || current.kind === 'loading' || current.kind === 'done') && (
        <Stack gap="xs">
          <Row gap="sm">
            <Button
              icon="upload"
              disabled={blocked || current.kind === 'loading'}
              onPress={() => openConfirm(draft.url)}
            >
              {`Post ${unposted} to GitLab`}
            </Button>
            {current.kind === 'loading' && <Spinner label="Checking GitLab" labelHidden />}
          </Row>
          {blocked && (
            <Text muted size="xs">
              {API_SCOPE_HINT}
            </Text>
          )}
        </Stack>
      )}
      {current.kind === 'confirm' && (
        <Confirm preview={current.preview} posting={isPosting(current)} onDraft={onDraft} />
      )}
      {error !== null && (
        <Callout tone="danger" icon="error" title="Couldn't post the Review Draft">
          {error}
        </Callout>
      )}
    </Stack>
  )
}

function Confirm(props: { preview: PostPreview; posting: boolean; onDraft: (draft: ReviewDraftView) => void }) {
  const { preview, posting } = props
  return (
    <Box border radius="md" padding="sm" direction="column" gap="sm">
      <Heading level={3}>Post review</Heading>
      <Text size="sm">
        {preview.comments === 0 ? 'No Review Comments post: only the summary and outcome.' : `${plural(preview.comments, 'Review Comment')} post as one review.`}
      </Text>
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
      <Textarea
        label="Summary"
        rows={3}
        placeholder="Optional: a note on the whole review"
        value={read(summary)}
        disabled={posting}
        onChange={(value) => set(summary, value)}
      />
      <Select
        label="Outcome"
        options={OUTCOMES}
        value={read(outcome)}
        disabled={posting}
        onChange={(value) => set(outcome, value as ReviewOutcome)}
      />
      <Row gap="sm">
        <Button icon="upload" disabled={posting} onPress={() => post(preview, props.onDraft)}>
          Post review
        </Button>
        <Button variant="ghost" disabled={posting} onPress={resetPosting}>
          Cancel
        </Button>
        {posting && <Spinner label="Posting" labelHidden />}
      </Row>
    </Box>
  )
}

function Outcome(props: { result: Omit<PostResult, 'draft'>; url: string; onDraft: (draft: ReviewDraftView) => void }) {
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
              <Button size="xs" icon="refresh" onPress={() => openConfirm(props.url)}>
                Retry
              </Button>
              <Button
                size="xs"
                variant="ghost"
                tone="danger"
                icon="delete"
                disabled={read(deleting)}
                onPress={() => deleteFailedDrafts(props.url, props.onDraft)}
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
