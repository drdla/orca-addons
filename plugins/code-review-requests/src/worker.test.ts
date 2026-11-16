// The worker under test runs over a mock Orca host with every outside seam faked: GitLab,
// the orca CLI and the clock (src/fakes).
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { fakeDeps } from './fakes'
import { createWorker } from './worker'

test('activating does not reach GitLab, the orca CLI or a timer before it is configured', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api' })
  const host = mockHost()

  const worker = await mountWorker(createWorker(fakes.deps), { host })

  assert.deepEqual(fakes.gitlab.requests, [])
  assert.deepEqual(fakes.cli.calls, [])
  assert.equal(fakes.clock.pending, 0)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the panel gets an empty snapshot from a fresh worker', async () => {
  const fakes = fakeDeps()
  const worker = await mountWorker(createWorker(fakes.deps), { host: mockHost() })

  assert.deepEqual(await worker.request('rr.snapshot'), { reviewRequests: [] })
  await worker.deactivate()
})
