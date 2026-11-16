// Turning a caught value into text, shared by the worker and the panel (no imports, so both can
// load it).

/** The message of an Error, or the value as a string. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
