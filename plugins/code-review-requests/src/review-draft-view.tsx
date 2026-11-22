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
  EmptyState,
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
  update,
  type OrcaNode,
  type PanelContext
} from 'orca'
import { Button } from './button'
import { BackButton } from './back-button'
import type { ReviewCommentView, ReviewDraftView } from './protocol'
import { isPostingNow, PostSection, resetPosting, setupPosting } from './review-post-view'
import { messageOf } from './errors'
import { plural } from './plural'
import { hasReviewPrompt } from './settings-view'
import { truncateMiddle } from './truncate-middle'

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
/** Which section button waits for the worker: "Go to diff view" or "Run Agent Review". */
const acting = atom<'changes' | 'agent' | null>(null)
/** Why the last of those didn't work. */
const actionError = atom<string | null>(null)

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
  set(actionError, null)
  resetPosting()
  importDraft()
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

/** The section buttons, like the In review card's: one request at a time, its error under the title. */
function act(which: 'changes' | 'agent', failed: string, action: () => Promise<unknown>): void {
  set(acting, which)
  set(actionError, null)
  action()
    .catch((error: unknown) => set(actionError, `${failed}: ${messageOf(error)}`))
    .finally(() => set(acting, null))
}

/** Orca's Source Control sidebar in the Review Workspace, for its changed files. */
function showChanges(url: string): void {
  act('changes', "Couldn't show the changed files", () => plugin.request('rr.showChanges', { url }))
}

function runAgentReview(url: string): void {
  act('agent', "Couldn't start the Agent Review", () => plugin.request('rr.runAgentReview', { url }, { timeoutMs: 120_000 }))
}

/** Characters a file path may take on a comment, and how many of its last ones always show. */
export const PATH_MAX = 60
export const PATH_KEEP_END = 14

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

/** Deletes an Agent Finding (diff-view notes are deleted in Orca's diff view). */
function deleteComment(id: string): void {
  const url = read(draftUrl)
  if (url === null) return
  setCommentError(id, null)
  plugin
    .request('rr.deleteDraftComment', { url, id })
    .then((answer) => {
      set(draft, answer)
      update(edits, (all) => {
        const next = { ...all }
        delete next[id]
        return next
      })
    })
    .catch((error: unknown) => setCommentError(id, messageOf(error)))
}

function setEdit(id: string, text: string): void {
  update(edits, (all) => ({ ...all, [id]: text }))
}

/** `src/a.ts:8–10`, `src/a.ts:10`, or "General comment"; a long path loses its middle. */
function locationOf(comment: ReviewCommentView): string {
  if (comment.filePath === null) return 'General comment'
  const path = truncateMiddle(comment.filePath, PATH_MAX, PATH_KEEP_END)
  if (comment.line === null) return path
  const lines = comment.startLine === undefined ? `${comment.line}` : `${comment.startLine}–${comment.line}`
  return `${path}:${lines}`
}

export function ReviewDraftScreen() {
  const current = read(draft)
  const failure = read(draftFailure)
  const url = read(draftUrl)
  const error = read(actionError)
  return (
    <Stack gap="md">
      <Row gap="sm">
        <BackButton onPress={closeReviewDraft} />
        <Heading level={2}>Finish Review</Heading>
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
          <Stack gap="lg">
            <Text weight="semibold">{current.title}</Text>
            <PostSection draft={current} onDraft={(answer) => set(draft, answer)} />
          </Stack>
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
          {error !== null && (
            <Text tone="danger" size="xs">
              {error}
            </Text>
          )}
          <Section
            title="Review Comments"
            empty={<EmptyState icon="branch" title="No Review Comments" />}
            comments={current.comments.filter((c) => c.origin === 'diff-note')}
            action={
              url !== null && (
                <SectionButton
                  which="changes"
                  icon="branch"
                  label="Open Diff View"
                  text
                  tooltip="Open Orca's diff view to add, edit or delete Review Comments"
                  onPress={() => showChanges(url)}
                />
              )
            }
          />
          <Section
            title="Agent Findings"
            empty={<EmptyState icon="agent" title="No Agent Findings" />}
            comments={current.comments.filter((c) => c.origin === 'agent-finding')}
            action={
              url !== null &&
              hasReviewPrompt() && (
                <SectionButton
                  which="agent"
                  icon="agent"
                  label="Run Agent Review"
                  tooltip="Start an agent review"
                  onPress={() => runAgentReview(url)}
                />
              )
            }
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

/** A section heading's icon button, with a spinner beside it while its request runs. */
function SectionButton(props: {
  which: 'changes' | 'agent'
  icon: 'branch' | 'agent'
  label: string
  /** Shows the label next to the icon instead of only as the tooltip's name. */
  text?: boolean
  tooltip: string
  onPress: () => void
}) {
  const current = read(acting)
  return (
    <Row gap="xs" align="center">
      {props.text === true ? (
        <Button
          icon={props.icon}
          tooltip={props.tooltip}
          variant="ghost"
          size="xs"
          disabled={current !== null}
          onPress={props.onPress}
        >
          {props.label}
        </Button>
      ) : (
        <IconButton
          icon={props.icon}
          label={props.label}
          tooltip={props.tooltip}
          variant="ghost"
          size="xs"
          disabled={current !== null}
          onPress={props.onPress}
        />
      )}
      {current === props.which && <Spinner label="Working" labelHidden />}
    </Row>
  )
}

function Section(props: { title: string; empty: OrcaNode; comments: ReviewCommentView[]; action?: OrcaNode }) {
  const { title, empty, comments, action } = props
  // paddingY: more room above each section than between the draft's other parts.
  return (
    <Box direction="column" gap="sm" paddingY="sm">
      <Row gap="xs" align="center">
        <Heading level={3}>{title}</Heading>
        {action}
      </Row>
      {comments.length === 0 ? (
        empty
      ) : (
        comments.map((c) => <CommentCard key={c.id} comment={c} />)
      )}
    </Box>
  )
}

/**
 * A diff-view note's way to edit or delete it: Orca has no API for either, nor for opening the
 * diff view at one note, so the button opens the workspace's changes. An Agent Finding's Delete.
 */
function CommentButtons({ comment }: { comment: ReviewCommentView }) {
  const url = read(draftUrl)
  if (comment.origin === 'diff-note') {
    if (comment.posted || url === null) return null
    return (
      <IconButton
        icon="edit"
        label="Edit or delete in the diff view"
        tooltip="Edit or delete this note in Orca's diff view"
        variant="ghost"
        size="xs"
        disabled={read(acting) !== null}
        onPress={() => showChanges(url)}
      />
    )
  }
  return (
    <IconButton
      icon="delete"
      label="Delete Agent Finding"
      tooltip="Remove this finding from the Review Draft"
      variant="ghost"
      tone="danger"
      size="xs"
      onPress={() => deleteComment(comment.id)}
    />
  )
}

/** Orca's Checkbox: a 16px box and an 8px gap before its label. */
const CHECKBOX_INDENT = 24

function CommentCard({ comment }: { comment: ReviewCommentView }) {
  const error = read(commentErrors)[comment.id]
  const edit = read(edits)[comment.id]
  const text = edit ?? comment.body
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between" align="start">
        {/* The body is the label and the location its description, which Orca draws small and
            muted in the same column: both start at one indent. An Agent Finding's body is the
            Textarea below, so its label just names it. */}
        <Checkbox
          label={comment.editable ? 'Agent Finding' : comment.body}
          description={locationOf(comment)}
          checked={comment.checked}
          disabled={comment.posted}
          onChange={(checked) => changeComment(comment.id, { checked })}
        />
        <Row gap="xs" align="center">
          {comment.outdated === true && <Badge tone="warning">May be outdated</Badge>}
          {comment.stale === true && <Badge tone="neutral">Stale</Badge>}
          {comment.posted && <Badge tone="success">Posted</Badge>}
          <CommentButtons comment={comment} />
        </Row>
      </Row>
      {(comment.editable || comment.failure !== undefined || error !== undefined) && (
        <Box direction="row">
          {/* The checkbox's width and gap, so this lines up with its label. */}
          <Box width={CHECKBOX_INDENT} shrink={false} />
          <Box direction="column" gap="xs" grow>
            {comment.editable && (
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
        </Box>
      )}
    </Box>
  )
}
