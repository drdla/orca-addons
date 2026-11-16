// The wording of every notification the plugin sends about Review Requests (#11, #23).
// Orca shows a plain title and body, prefixed with the plugin's name; notifications only inform.
import type { ReviewRequestView } from '../protocol'
import { isEnded, type DropReason, type Dropped } from './changes'

export type Note = { title: string; body: string }

/** How many items a summary lists before "+N more". */
const TOP = 3

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function line(r: ReviewRequestView): string {
  return `!${r.iid} ${r.title}`
}

function listed(items: ReviewRequestView[]): string[] {
  const head = items.slice(0, TOP).map(line)
  return items.length > TOP ? [...head, `+${items.length - TOP} more`] : head
}

/** First run: what is already waiting. Null when nothing is. */
export function firstRunNote(waiting: ReviewRequestView[], overdue = 0): Note | null {
  if (waiting.length === 0) return null
  const lines = overdue > 0 ? [`${overdue} overdue.`, ...listed(waiting)] : listed(waiting)
  return { title: `${plural(waiting.length, 'Review Request')} waiting`, body: lines.join('\n') }
}

/** Catch-up: one summary of what changed while away. Null when nothing did. */
export function catchUpNote(added: ReviewRequestView[], dropped: Dropped[]): Note | null {
  const ended = dropped.filter(isEnded)
  const drafts = dropped.filter((d) => d.reason === 'draft')
  const hidden = dropped.filter((d) => d.reason === 'not-visible')
  const parts: string[] = []
  if (added.length > 0) parts.push(`${added.length} new`)
  if (ended.length > 0) parts.push(`${ended.length} ended`)
  if (drafts.length > 0) parts.push(`${drafts.length} made draft`)
  if (hidden.length > 0) parts.push(`${hidden.length} no longer visible`)
  if (parts.length === 0) return null
  const iids = (items: Dropped[]) => items.map((d) => `!${d.iid}`).join(', ')
  const lines = [...listed(added)]
  if (ended.length > 0) lines.push(`Ended: ${iids(ended)}`)
  if (drafts.length > 0) lines.push(`Made draft: ${iids(drafts)}`)
  if (hidden.length > 0) lines.push(`No longer visible: ${iids(hidden)}`)
  return { title: `While you were away: ${parts.join(', ')}`, body: lines.join('\n') }
}

/** Live poll: one Review Request appeared. */
export function newNote(r: ReviewRequestView): Note {
  return { title: 'New Review Request', body: `${line(r)}\n${r.projectPath} · ${r.author}` }
}

const DROPPED_TITLES: Record<DropReason, string> = {
  approved: 'Review Request ended: approved',
  merged: 'Review Request ended: merged',
  closed: 'Review Request ended: closed',
  unassigned: 'Review Request ended: you were removed as Reviewer',
  'not-visible': 'Review Request no longer visible',
  draft: 'Review Request made draft'
}

/** Live poll: one Review Request dropped off the list. */
export function droppedNote(d: Dropped): Note {
  return { title: DROPPED_TITLES[d.reason], body: `${line(d)}\n${d.projectPath}` }
}
