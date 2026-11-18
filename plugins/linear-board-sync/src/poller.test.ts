// The poll schedule: stop/start, and one poll at a time.
import { assert, test } from 'orca/testing'
import { FakeClock } from './fakes/fake-clock'
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
