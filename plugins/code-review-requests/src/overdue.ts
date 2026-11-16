// Overdue Review Requests (GLOSSARY.md, #10 amendment): waiting longer than the "Overdue after"
// setting since the user was added as Reviewer, counting Monday to Friday only, in the machine's
// local time, with no holiday calendar. Only the highlight signals it; nothing notifies.

const HOUR = 3_600_000

/** Milliseconds between `from` and `to` that fall on a local Monday to Friday. */
export function workingMsBetween(from: number, to: number): number {
  let total = 0
  let cursor = from
  while (cursor < to) {
    const day = new Date(cursor)
    const nextMidnight = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
    const end = Math.min(nextMidnight, to)
    const weekday = day.getDay()
    if (weekday !== 0 && weekday !== 6) total += end - cursor
    cursor = end
  }
  return total
}

/** True once more than `overdueHours` working hours have passed since `requestedAt`. */
export function isOverdue(requestedAt: number, now: number, overdueHours: number): boolean {
  return workingMsBetween(requestedAt, now) > overdueHours * HOUR
}
