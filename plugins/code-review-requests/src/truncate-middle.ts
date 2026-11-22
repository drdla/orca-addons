// Shortening a long string in the middle, keeping its end: for file paths, whose end (the file
// name) matters most.

/**
 * `text` at most `max` characters long: its start, "…", and its last `keepEnd` characters.
 * Shorter text comes back as it is.
 */
export function truncateMiddle(text: string, max: number, keepEnd: number): string {
  if (text.length <= max) return text
  const end = Math.min(keepEnd, max - 1)
  const start = max - 1 - end
  return `${text.slice(0, start)}…${end === 0 ? '' : text.slice(-end)}`
}
