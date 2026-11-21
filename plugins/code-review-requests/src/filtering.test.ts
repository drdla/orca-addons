// Filters end to end (#26), through the worker's public surface: a configured worker over the fake
// GitLab and fake clock, observed through the bell, rr.snapshot and notifications.show. The rules
// themselves are in filters.test.ts.
import { assert, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import { CONFIGURED, lastStatusBar, MINUTE, startWorker as startHarness } from './testing/worker-harness'

type Note = { title: string; body?: string }

/** A configured worker whose settings changes reach it (the kit never fires onDidChange). */
async function startWorker(fakes: Fakes, settings: Record<string, string | number>) {
  const { host, worker, changeSetting } = await startHarness(fakes, { ...CONFIGURED, ...settings })
  const bell = () => lastStatusBar(host)
  const notes = () => host.callsOf('notifications.show') as Note[]
  return { host, worker, changeSetting, bell, notes }
}

test('filtered-out Review Requests are not listed or counted, but the panel learns how many', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'Shown' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/legacy', iid: 2 })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/web', iid: 3, author: 'renovate-bot' })

  const { worker, bell } = await startWorker(fakes, { pathBlocklist: 'acme/legacy', authorBlocklist: '@renovate-bot' })

  assert.equal(bell()?.text, '1')
  const snapshot = await worker.request('rr.snapshot')
  assert.deepEqual(
    snapshot.reviewRequests.map((r) => r.title),
    ['Shown']
  )
  assert.equal(snapshot.hiddenByFilters, 2)
  assert.equal(snapshot.invalidFilterEntries, undefined)
  await worker.deactivate()
})

test('the snapshot names invalid filter entries', async () => {
  const fakes = fakeDeps()
  const { worker } = await startWorker(fakes, { pathAllowlist: 'acme//api, acme', authorBlocklist: 'no!' })

  const snapshot = await worker.request('rr.snapshot')
  assert.deepEqual(snapshot.invalidFilterEntries, ['acme//api', 'no!'])
  await worker.deactivate()
})

test('filtered-out Review Requests never notify: not on first run, not when new, not when they end', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1, title: 'Shown' })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/legacy', iid: 2, title: 'Hidden' })
  const { worker, notes } = await startWorker(fakes, { pathBlocklist: 'acme/legacy' })

  assert.equal(notes().length, 1)
  assert.equal(notes()[0]!.title, '1 Review Request waiting')
  assert.ok(!/Hidden/.test(notes()[0]!.body ?? ''))

  fakes.gitlab.addMergeRequest({ projectPath: 'acme/legacy/api', iid: 3, title: 'Also hidden' })
  fakes.gitlab.merge('acme/legacy', 2)
  await fakes.clock.advance(5 * MINUTE)

  assert.equal(notes().length, 1)
  await worker.deactivate()
})

test('excluding a project hides its Review Requests at once, without "ended" notifications', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1 })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/legacy', iid: 2 })
  const { worker, notes, bell, changeSetting } = await startWorker(fakes, {})
  assert.equal(bell()?.text, '2')

  await changeSetting('pathBlocklist', 'acme/legacy')

  assert.equal(bell()?.text, '1')
  assert.equal(notes().length, 1)
  assert.equal((await worker.request('rr.snapshot')).hiddenByFilters, 1)
  await worker.deactivate()
})

test('showing a project again is silent: no "new" notifications', async () => {
  const fakes = fakeDeps()
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 1 })
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/legacy', iid: 2 })
  const { worker, notes, bell, changeSetting } = await startWorker(fakes, { pathBlocklist: 'acme/legacy' })

  await changeSetting('pathBlocklist', '')

  assert.equal(bell()?.text, '2')
  assert.equal(notes().length, 1)
  await worker.deactivate()
})
