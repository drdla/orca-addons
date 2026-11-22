// The wording of every notification the plugin sends about Review Requests (#11, #23).
// Orca shows a plain title and body, prefixed with the plugin's name; notifications only inform.
// A single notification's title says what happened in a sentence naming the merge request, and
// its body where it is (`acme/api !7`); summaries list those sentences.
import type { ReviewRequestView } from '../protocol'
import { authorNameOf } from '../author'
import { plural } from '../plural'
import { isEnded, type DropReason, type Dropped } from './changes'

export type Note = { title: string; body: string }

/** How many items a summary lists before "+N more". */
const TOP = 3

/** What a single notification's body says: where the merge request is. */
function where(r: ReviewRequestView): string {
  return `${r.projectPath} !${r.iid}`
}

/** "Ada Lovelace asked you to review Add login". */
function added(r: ReviewRequestView): string {
  return `${authorNameOf(r)} asked you to review ${r.title}`
}

const DROPPED: Record<DropReason, (title: string) => string> = {
  // Never sent (notifier.ts): the user approved it themselves.
  approved: (title) => `You approved ${title}`,
  merged: (title) => `${title} was merged`,
  closed: (title) => `${title} was closed`,
  unassigned: (title) => `You were removed as reviewer of ${title}`,
  'not-visible': (title) => `${title} is no longer visible to you`,
  draft: (title) => `${title} was made a draft`
}

/** "Add login was merged". */
function dropped(d: Dropped): string {
  return DROPPED[d.reason](d.title)
}

function listed(lines: string[]): string[] {
  const head = lines.slice(0, TOP)
  return lines.length > TOP ? [...head, `+${lines.length - TOP} more`] : head
}

/** First run: what is already waiting. Null when nothing is. */
export function firstRunNote(waiting: ReviewRequestView[], overdue = 0): Note | null {
  if (waiting.length === 0) return null
  const lines = listed(waiting.map(added))
  return {
    title: `${plural(waiting.length, 'Review Request')} waiting`,
    body: (overdue > 0 ? [`${overdue} overdue.`, ...lines] : lines).join('\n')
  }
}

/** Catch-up: one summary of what changed while away. Null when nothing did. */
export function catchUpNote(addedItems: ReviewRequestView[], droppedItems: Dropped[]): Note | null {
  const ended = droppedItems.filter(isEnded).length
  const drafts = droppedItems.filter((d) => d.reason === 'draft').length
  const hidden = droppedItems.filter((d) => d.reason === 'not-visible').length
  const parts: string[] = []
  if (addedItems.length > 0) parts.push(`${addedItems.length} new`)
  if (ended > 0) parts.push(`${ended} ended`)
  if (drafts > 0) parts.push(`${drafts} made draft`)
  if (hidden > 0) parts.push(`${hidden} no longer visible`)
  if (parts.length === 0) return null
  const lines = listed([...addedItems.map(added), ...droppedItems.map(dropped)])
  return { title: `While you were away: ${parts.join(', ')}`, body: lines.join('\n') }
}

/** Live poll: one Review Request appeared: "Ada Lovelace asked you to review Add login". */
export function newNote(r: ReviewRequestView): Note {
  return { title: added(r), body: where(r) }
}

/** Live poll: one Review Request dropped off the list: "Add login was merged". */
export function droppedNote(d: Dropped): Note {
  return { title: dropped(d), body: where(d) }
}
