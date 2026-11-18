// The Clock seam: every read of the time and every timer in the worker goes through it, so tests
// step time by hand (src/fakes/fake-clock.ts) and never use real timers.

export type Disposable = { dispose(): void }

/** A timer callback. A returned promise is awaited by the fake clock before time moves on. */
export type Tick = () => void | Promise<void>

export interface Clock {
  /** Wall-clock milliseconds since the epoch. */
  now(): number
  /** Calls `tick` every `ms` until disposed. */
  every(ms: number, tick: Tick): Disposable
  /** Calls `tick` once after `ms`, unless disposed first. */
  after(ms: number, tick: Tick): Disposable
}

/**
 * The production clock. Node timers pause while the machine sleeps and there is no wake event,
 * so pollers should tick often and compare `now()` with the time of their last run.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  every(ms, tick) {
    const handle = setInterval(() => void run(tick), ms)
    return { dispose: () => clearInterval(handle) }
  },
  after(ms, tick) {
    const handle = setTimeout(() => void run(tick), ms)
    return { dispose: () => clearTimeout(handle) }
  }
}

/** Swallows a rejected tick: an unhandled rejection would crash the worker. */
async function run(tick: Tick): Promise<void> {
  try {
    await tick()
  } catch {
    // Callers handle and report their own errors; this only keeps the process alive.
  }
}
