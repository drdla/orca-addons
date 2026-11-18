/** `1 card`, `2 cards`. */
export function counted(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}
