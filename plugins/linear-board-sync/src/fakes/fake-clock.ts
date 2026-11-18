// An in-memory Clock for tests: time moves only when the test calls advance() or sleep().
import type { Clock, Disposable, Tick } from '../seams/clock'

type Timer = { id: number; due: number; period: number | null; tick: Tick }

export class FakeClock implements Clock {
  #now: number
  #timers: Timer[] = []
  #nextId = 1

  constructor(start = Date.UTC(2026, 10, 16, 9, 0, 0)) {
    this.#now = start
  }

  now(): number {
    return this.#now
  }

  every(ms: number, tick: Tick): Disposable {
    return this.#add(ms, ms, tick)
  }

  after(ms: number, tick: Tick): Disposable {
    return this.#add(ms, null, tick)
  }

  /** How many timers are scheduled. */
  get pending(): number {
    return this.#timers.length
  }

  /**
   * Moves time forward by `ms`, firing every timer that falls due on the way, in order, and
   * awaiting each tick before going on.
   */
  async advance(ms: number): Promise<void> {
    const end = this.#now + ms
    for (;;) {
      const next = this.#timers
        .filter((t) => t.due <= end)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0]
      if (!next) break
      this.#now = next.due
      if (next.period === null) this.#remove(next.id)
      else next.due += next.period
      await next.tick()
    }
    this.#now = end
  }

  /**
   * The machine sleeps for `ms`: the wall clock jumps, but timers are paused, so each one falls due
   * `ms` later than planned and nothing fires during the gap (as Node timers behave on macOS).
   */
  sleep(ms: number): void {
    this.#now += ms
    for (const timer of this.#timers) timer.due += ms
  }

  #add(ms: number, period: number | null, tick: Tick): Disposable {
    const id = this.#nextId++
    this.#timers.push({ id, due: this.#now + ms, period, tick })
    return { dispose: () => this.#remove(id) }
  }

  #remove(id: number): void {
    this.#timers = this.#timers.filter((t) => t.id !== id)
  }
}
