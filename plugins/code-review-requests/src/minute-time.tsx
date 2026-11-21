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

/** An age, short like Orca's workspace list: "1m", "5m", "2h", "3d". Times ahead of now count as "1m". */
export function formatAge(at: number, now: number): string {
  const size = Math.max(now - at, 0)
  if (size < MINUTE) return '1m'
  const unitMs = unitOf(size)
  const unit = unitMs === MINUTE ? 'm' : unitMs === HOUR ? 'h' : 'd'
  return `${Math.floor(size / unitMs)}${unit}`
}

/** When formatAgo(at, …) or formatAge(at, …) next reads differently. */
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

/**
 * MinuteTime's text as a plain string, for places that take only text, such as a Button's label.
 * Call it while rendering: it asks for the redraw at the next change the same way.
 */
export function minuteTimeText(at: number, age = false): string {
  const now = Math.max(read(clock), Date.now())
  wakeAt(nextChangeAt(at, now))
  return age ? formatAge(at, now) : formatAgo(at, now)
}

/**
 * A relative time with whole minutes at most, kept current; inline, so it may sit inside Text.
 * `age` reads "3d" instead of "3d ago".
 */
export function MinuteTime(props: { at: number; tone?: Tone; age?: boolean }) {
  const text = minuteTimeText(props.at, props.age === true)
  if (props.tone === undefined) return text
  return <Text tone={props.tone}>{text}</Text>
}
