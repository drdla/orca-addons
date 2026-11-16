import { assert, test } from 'orca/testing'
import { FakeClock } from './fake-clock'

test('an interval fires once per period as time is advanced by hand', async () => {
  const clock = new FakeClock(1_000)
  const fired: number[] = []
  clock.every(100, () => {
    fired.push(clock.now())
  })
  await clock.advance(250)
  assert.deepEqual(fired, [1_100, 1_200])
  assert.equal(clock.now(), 1_250)
})

test('a one-shot timer fires once and a disposed timer never fires', async () => {
  const clock = new FakeClock(0)
  const fired: string[] = []
  clock.after(50, () => {
    fired.push('once')
  })
  const cancelled = clock.after(60, () => {
    fired.push('cancelled')
  })
  cancelled.dispose()
  await clock.advance(1_000)
  assert.deepEqual(fired, ['once'])
  assert.equal(clock.pending, 0)
})

test('an async tick is awaited before time moves on', async () => {
  const clock = new FakeClock(0)
  const order: string[] = []
  clock.every(10, async () => {
    order.push(`start ${clock.now()}`)
    await Promise.resolve()
    order.push(`end ${clock.now()}`)
  })
  await clock.advance(20)
  assert.deepEqual(order, ['start 10', 'end 10', 'start 20', 'end 20'])
})

test('during sleep the wall clock jumps but paused timers fire nothing', async () => {
  const clock = new FakeClock(0)
  const fired: number[] = []
  clock.every(100, () => {
    fired.push(clock.now())
  })
  await clock.advance(50)
  clock.sleep(10_000)
  assert.deepEqual(fired, [])
  assert.equal(clock.now(), 10_050)
  await clock.advance(50)
  assert.deepEqual(fired, [10_100])
})
