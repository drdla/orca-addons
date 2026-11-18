/** A caught value's message, for logs and the status bar. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
