import { assert, test } from 'orca/testing'
import { OrcaCliError } from '../seams/orca-cli'
import { FakeOrcaCli } from './fake-orca-cli'

const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'

test('a created worktree is listed with its MR link and can be shown with its diff comments', async () => {
  const cli = new FakeOrcaCli()
  const created = await cli.createWorktree({
    name: 'review-api-7',
    project: 'git:gitlab.example.com/acme/api',
    baseBranch: 'origin/feature-7',
    references: [MR_URL]
  })

  const listed = await cli.listWorktrees()
  assert.deepEqual(listed.map((w) => w.id), [created.id])
  assert.deepEqual(listed[0]?.linkedItems.map((l) => l.url), [MR_URL])

  cli.setDiffComments(created.id, [
    { id: 'n1', worktreeId: created.id, filePath: 'a.ts', lineNumber: 3, body: 'Hm', createdAt: 1, side: 'modified' }
  ])
  const shown = await cli.showWorktree(`id:${created.id}`)
  assert.deepEqual(shown.diffComments?.map((c) => c.body), ['Hm'])
})

test('removing a dirty worktree is refused unless forced', async () => {
  const cli = new FakeOrcaCli()
  const wt = cli.addWorktree({ name: 'dirty', dirty: true })

  await assert.rejects(cli.removeWorktree(`id:${wt.id}`), (error) => {
    return error instanceof OrcaCliError && error.code === 'worktree_dirty'
  })
  assert.equal((await cli.listWorktrees()).length, 1)

  await cli.removeWorktree(`id:${wt.id}`, { force: true })
  assert.deepEqual(await cli.listWorktrees(), [])
})

test('an unknown selector is refused with selector_not_found', async () => {
  const cli = new FakeOrcaCli()
  await assert.rejects(cli.showWorktree('id:nope'), (error) => {
    return error instanceof OrcaCliError && error.code === 'selector_not_found'
  })
})

test('an injected failure rejects the next call only, and every call is recorded', async () => {
  const cli = new FakeOrcaCli()
  cli.failNext(new OrcaCliError('unavailable', 'orca CLI not found'))
  await assert.rejects(cli.listWorktrees(), (error) => {
    return error instanceof OrcaCliError && error.code === 'unavailable'
  })
  await cli.listWorktrees()
  assert.deepEqual(cli.calls.map((c) => c.command), ['worktree list', 'worktree list'])
})
