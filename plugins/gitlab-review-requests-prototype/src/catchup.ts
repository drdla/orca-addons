// PROTOTYPE — throwaway. Answers "How should first-run and catch-up notifications behave?"
// (drdla/orca-addons#11). Computes which desktop notifications each strategy sends for a
// scenario; the worker fires them for real through notifications.show.
import type { CatchUpScenario, CatchUpStrategy } from './protocol'

type Item = { iid: number; title: string; project: string; author: string }
type EndedItem = Item & { reason: 'approved' | 'merged' | 'closed' | 'reviewer removed' }
type Scenario = {
  label: string
  firstRun: boolean
  away: string // how long Orca was closed, for the summary wording
  existing: number // already known before Orca closed (baseline)
  added: Item[]
  ended: EndedItem[]
  overdue: number
  transient: number // appeared and ended while away: never seen, never notified
}

const POOL: Item[] = [
  { iid: 3104, title: 'Site picker: keyboard navigation and empty state', project: 'frontend/web-app', author: 'tpetrov' },
  { iid: 3101, title: 'Fix timezone drift in delivery calendar', project: 'frontend/web-app', author: 'mkovac' },
  { iid: 77, title: 'Bump node to 22 in CI images', project: 'infra/ci-images', author: 'jlee' },
  { iid: 1291, title: 'Migrate delivery-note parser to the new OCR pipeline', project: 'logistics/ingest/delivery-notes', author: 'sabine.h' },
  { iid: 482, title: 'Add idempotency keys to invoice webhook handler', project: 'platform/billing/invoice-service', author: 'mkovac' },
  { iid: 512, title: 'Rate-limit the public tracking endpoint', project: 'platform/gateway', author: 'r.weber' },
  { iid: 88, title: 'Terraform: split staging and prod state', project: 'infra/terraform', author: 'jlee' },
  { iid: 2290, title: 'Carrier import: tolerate BOM in CSV', project: 'logistics/ingest/carriers', author: 'sabine.h' },
  { iid: 3120, title: 'Dark mode for the dispatch board', project: 'frontend/web-app', author: 'tpetrov' }
]
const ENDED: EndedItem[] = [
  { iid: 465, title: 'Retry failed SEPA exports', project: 'platform/billing/invoice-service', author: 'mkovac', reason: 'approved' },
  { iid: 1270, title: 'Parser: handle rotated scans', project: 'logistics/ingest/delivery-notes', author: 'sabine.h', reason: 'merged' },
  { iid: 71, title: 'Pin base image digests', project: 'infra/ci-images', author: 'jlee', reason: 'closed' },
  { iid: 3088, title: 'Remove legacy map widget', project: 'frontend/web-app', author: 'tpetrov', reason: 'reviewer removed' }
]

export const SCENARIOS: Record<CatchUpScenario, Scenario> = {
  live: { label: 'Live poll (reference): 1 new', firstRun: false, away: '', existing: 4, added: POOL.slice(0, 1), ended: [], overdue: 0, transient: 0 },
  'first-run': { label: 'First run: 5 already waiting', firstRun: true, away: '', existing: 0, added: POOL.slice(0, 5), ended: [], overdue: 2, transient: 0 },
  short: { label: 'Back after 2h: 1 new, 1 ended', firstRun: false, away: '2 hours', existing: 4, added: POOL.slice(0, 1), ended: ENDED.slice(0, 1), overdue: 0, transient: 0 },
  weekend: { label: 'Back after weekend: 3 new, 2 ended', firstRun: false, away: 'the weekend', existing: 3, added: POOL.slice(0, 3), ended: ENDED.slice(0, 2), overdue: 1, transient: 1 },
  vacation: { label: 'Back after 2 weeks: 9 new, 4 ended', firstRun: false, away: '2 weeks', existing: 2, added: POOL, ended: ENDED, overdue: 6, transient: 5 }
}

export const STRATEGIES: Record<CatchUpStrategy, string> = {
  silent: 'Silent baseline (panel marks New, nothing pops)',
  summary: 'One summary notification',
  'per-item': 'One notification per item',
  hybrid: 'Per item up to the cap, else one summary',
  split: 'New per item up to the cap, ended always summarised'
}

type Note = { title: string; body: string }
const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const line = (i: Item) => `!${i.iid} ${i.title}`

function newOne(i: Item): Note {
  return { title: 'New Review Request', body: `${line(i)}\n${i.project} · ${i.author}` }
}
function endedOne(e: EndedItem): Note {
  return { title: `Review Request ${e.reason === 'reviewer removed' ? 'ended: you were removed' : e.reason}`, body: `${line(e)}\n${e.project}` }
}
function listed(items: Item[], max = 3): string {
  const head = items.slice(0, max).map(line)
  return head.join('\n') + (items.length > max ? `\n+${items.length - max} more` : '')
}
function summaryNew(sc: Scenario): Note {
  if (sc.firstRun)
    return {
      title: `${s(sc.added.length, 'Review Request')} waiting`,
      body: (sc.overdue ? `${sc.overdue} overdue. ` : '') + 'Now watching GitLab.\n' + listed(sc.added)
    }
  return { title: `${s(sc.added.length, 'new Review Request')} while you were away`, body: listed(sc.added) }
}
function summaryEnded(sc: Scenario): Note {
  return { title: `${s(sc.ended.length, 'Review Request')} ended while you were away`, body: listed(sc.ended) }
}
function summaryBoth(sc: Scenario): Note {
  if (sc.firstRun || !sc.ended.length) return summaryNew(sc)
  if (!sc.added.length) return summaryEnded(sc)
  return {
    title: `While you were away: ${sc.added.length} new, ${sc.ended.length} ended`,
    body: listed(sc.added, 2) + `\nEnded: ${sc.ended.map((e) => `!${e.iid}`).join(', ')}`
  }
}

export function plan(strategy: CatchUpStrategy, scenario: CatchUpScenario, cap: number): { sent: Note[]; note: string } {
  const sc = SCENARIOS[scenario]
  const extras: string[] = []
  if (sc.transient) extras.push(`${sc.transient} appeared and ended while away: never notified`)
  if (sc.overdue) extras.push(`${sc.overdue} overdue: shown only in the panel/bell`)

  // Live polling is already settled (one per item); every strategy behaves the same there.
  if (scenario === 'live') return { sent: sc.added.map(newOne), note: 'Live poll: one per item (settled). ' + extras.join('; ') }

  let sent: Note[] = []
  switch (strategy) {
    case 'silent':
      sent = []
      break
    case 'summary':
      sent = [summaryBoth(sc)]
      break
    case 'per-item':
      sent = [...sc.added.map(newOne), ...(sc.firstRun ? [] : sc.ended.map(endedOne))]
      break
    case 'hybrid': {
      const total = sc.added.length + sc.ended.length
      sent = sc.firstRun ? [summaryNew(sc)] : total <= cap ? [...sc.added.map(newOne), ...sc.ended.map(endedOne)] : [summaryBoth(sc)]
      break
    }
    case 'split':
      sent = sc.firstRun
        ? [summaryNew(sc)]
        : [...(sc.added.length <= cap ? sc.added.map(newOne) : [summaryNew(sc)]), ...(sc.ended.length ? [summaryEnded(sc)] : [])]
      break
  }
  return { sent, note: `${sc.label} → ${sent.length} notification${sent.length === 1 ? '' : 's'}. ` + extras.join('; ') }
}
