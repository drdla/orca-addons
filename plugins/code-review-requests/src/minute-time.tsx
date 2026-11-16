// Relative times without seconds: "just now" under a minute, then "1m ago", "2h ago", "3d ago".
// Orca's RelativeTime counts seconds ("12s ago") and redraws every second under a minute, so the
// panel formats these itself and redraws only when a shown minute (or hour, or day) changes:
// each MinuteTime asks for a tick at its next change, and one timer serves the earliest.
import { atom, read, set, Text, type PanelContext, type Tone } from 'orca'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The time the shown texts were worked out at; a tick sets it. */
const clock = atom(Date.now())

let pendingAt: number | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let active = false

function unitOf(size: number): number {
  return size < HOUR ? MINUTE : size < DAY ? HOUR : DAY
}

/** "just now", "5m ago", "2h ago", "3d ago"; ahead of now "shortly", "in 5m". */
export function formatAgo(at: number, now: number, locale?: string): string {
  const diff = at - now
  const size = Math.abs(diff)
  if (size < MINUTE) return diff > 0 ? 'shortly' : 'just now'
  const unitMs = unitOf(size)
  const unit = unitMs === MINUTE ? 'minute' : unitMs === HOUR ? 'hour' : 'day'
  const value = Math.trunc(diff / unitMs)
  return new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric: 'always' }).format(value, unit)
}

/** When formatAgo(at, …) next reads differently. */
export function nextChangeAt(at: number, now: number): number {
  if (at > now) {
    const ahead = at - now
    if (ahead < MINUTE) return at
    const unitMs = unitOf(ahead)
    return Math.max(at - Math.floor(ahead / unitMs) * unitMs, now + 1000)
  }
  const ago = now - at
  const unitMs = unitOf(ago)
  return at + (Math.floor(ago / unitMs) + 1) * unitMs
}

function tick(): void {
  pendingAt = null
  pendingTimer = null
  if (active) set(clock, Date.now())
}

/** Asks for a redraw at `at`, unless an earlier one is already due. Not an atom write: safe in render. */
function wakeAt(at: number): void {
  if (!active || (pendingAt !== null && pendingAt <= at)) return
  if (pendingTimer !== null) clearTimeout(pendingTimer)
  pendingAt = at
  pendingTimer = setTimeout(tick, Math.max(at - Date.now(), 0))
}

/** Starts the clock for this panel run; it stops when the panel closes. */
export function setupClock(ctx: PanelContext): void {
  active = true
  set(clock, Date.now())
  ctx.subscriptions.push({
    dispose() {
      active = false
      if (pendingTimer !== null) clearTimeout(pendingTimer)
      pendingTimer = null
      pendingAt = null
    }
  })
}

/** A relative time with whole minutes at most, kept current; inline, so it may sit inside Text. */
export function MinuteTime(props: { at: number; tone?: Tone }) {
  const now = Math.max(read(clock), Date.now())
  wakeAt(nextChangeAt(props.at, now))
  const text = formatAgo(props.at, now)
  if (props.tone === undefined) return text
  return <Text tone={props.tone}>{text}</Text>
}
