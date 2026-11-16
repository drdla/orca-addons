// The schedule controls failure handling (#24) uses: retryAt() for backoff, stop() for Needs you.
import { assert, test } from 'orca/testing'
import { FakeClock } from '../fakes'
import { createPoller } from './poller'

const MINUTE = 60_000

function setup() {
  const clock = new FakeClock()
  const polledAt: number[] = []
  const start = clock.now()
  const poller = createPoller({
    clock,
    intervalMs: 5 * MINUTE,
    poll: async () => void polledAt.push((clock.now() - start) / MINUTE)
  })
  return { clock, poller, polledAt }
}

test('retryAt moves the next poll, after which the interval applies again', async () => {
  const { clock, poller, polledAt } = setup()
  poller.start()
  await clock.advance(0)

  poller.retryAt(clock.now() + 1 * MINUTE)
  await clock.advance(7 * MINUTE)

  assert.deepEqual(polledAt, [0, 1, 6])
})

test('retryAt called from inside a poll applies to the poll after it', async () => {
  const clock = new FakeClock()
  const start = clock.now()
  const polledAt: number[] = []
  const poller = createPoller({
    clock,
    intervalMs: 5 * MINUTE,
    poll: async () => {
      polledAt.push((clock.now() - start) / MINUTE)
      if (polledAt.length === 1) poller.retryAt(clock.now() + 1 * MINUTE)
    }
  })
  poller.start()
  await clock.advance(2 * MINUTE)

  assert.deepEqual(polledAt, [0, 1])
})

test('stop ends polling until start, and start polls at once', async () => {
  const { clock, poller, polledAt } = setup()
  poller.start()
  await clock.advance(0)
  poller.stop()

  await clock.advance(30 * MINUTE)
  assert.deepEqual(polledAt, [0])
  assert.equal(clock.pending, 0)

  poller.start()
  await clock.advance(0)
  assert.deepEqual(polledAt, [0, 30])
})

test('pollNow while a poll is in flight waits for that one instead of starting another', async () => {
  const clock = new FakeClock()
  let polls = 0
  let release: () => void = () => {}
  const poller = createPoller({
    clock,
    intervalMs: 5 * MINUTE,
    poll: () => {
      polls++
      return new Promise<void>((resolve) => (release = resolve))
    }
  })

  const first = poller.pollNow()
  const second = poller.pollNow()
  release()
  await Promise.all([first, second])
  assert.equal(polls, 1)
})
