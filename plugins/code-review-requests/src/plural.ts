// Counting words, shared by the worker and the panel (no imports, so both can load it).

/** "1 Review Comment", "2 Review Comments". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
