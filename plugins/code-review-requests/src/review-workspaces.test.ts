// Review Workspaces end to end through the worker (#27): finding them on each poll, Start review
// (with or without an Agent Review), Open workspace and Run Agent Review. GitLab, the orca CLI,
// git and the clock are fakes; Orca's host is the kit's mock host.
import { assert, mockHost, test } from 'orca/testing'
import { fakeDeps, type Fakes } from './fakes'
import { OrcaCliError } from './seams/orca-cli'
import { CONFIGURED, lastStatusBar, MINUTE, startWorker as startHarness } from './testing/worker-harness'
const MR_URL = 'https://gitlab.example.com/acme/api/-/merge_requests/7'
const REPO = { repoId: 'repo-api', projectId: 'git:gitlab.example.com/acme/api', path: '/src/api' }

/** What `workspace.list` answers: the host's ids for the repo and the workspaces the test makes. */
function workspaceList(...paths: string[]) {
  return {
    workspaces: paths.map((path, i) => ({
      id: `ws-${i}`,
      kind: 'worktree' as const,
      name: path.split('/').at(-1)!,
      path,
      branch: null,
      hostId: 'local'
    })),
    truncated: false
  }
}

async function startWorker(
  fakes: Fakes,
  options: { settings?: Record<string, string | number>; workspaces?: string[] } = {}
) {
  const settings = { ...CONFIGURED, ...options.settings }
  const host = mockHost({
    settings,
    results: {
      'workspace.list': workspaceList(...(options.workspaces ?? [])),
      'terminal.create': { terminalId: 'term-cmd' },
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  return startHarness(fakes, settings, host)
}

function addReviewRequest(fakes: Fakes) {
  fakes.gitlab.addMergeRequest({
    projectPath: 'acme/api',
    iid: 7,
    title: 'Add login',
    author: 'ada',
    sourceBranch: 'feature/login',
    targetBranch: 'main'
  })
}

/** The Agent Reviews launched through `orca agent launch`. */
function agentLaunches(fakes: Fakes) {
  return fakes.cli.calls.filter((c) => c.command === 'agent launch').map((c) => c.args)
}

function worktreeLists(fakes: Fakes): number {
  return fakes.cli.calls.filter((c) => c.command === 'worktree list').length
}

test('a Review Request with a linked workspace carries it in the snapshot; one worktree list per poll', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 8 })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: '/wt/review-api-7', references: [MR_URL] })

  const { worker } = await startWorker(fakes)

  assert.equal(worktreeLists(fakes), 1)
  const cards = (await worker.request('rr.snapshot')).reviewRequests
  const seven = cards.find((c) => c.iid === 7)!
  assert.deepEqual(seven.workspace, { id: `${REPO.repoId}::/wt/review-api-7`, name: 'review-api-7', path: '/wt/review-api-7' })
  assert.equal(cards.find((c) => c.iid === 8)!.workspace, null)

  await fakes.clock.advance(5 * MINUTE)
  assert.equal(worktreeLists(fakes), 2)
  await worker.deactivate()
})

test('a filtered-out Review Request with a Review Workspace stays listed, under its workspace', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.gitlab.addMergeRequest({ projectPath: 'acme/api', iid: 8, title: 'Filtered, no workspace' })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'by-hand', repoId: REPO.repoId, path: '/wt/by-hand', references: [MR_URL] })

  const { host, worker } = await startWorker(fakes, { settings: { pathBlocklist: 'acme/api' } })

  const cards = (await worker.request('rr.snapshot')).reviewRequests
  assert.deepEqual(cards.map((c) => c.title), ['Add login'])
  assert.equal(cards[0]!.workspace?.name, 'by-hand')
  assert.equal(lastStatusBar(host)?.text, '1')
  await worker.deactivate()
})

test('Start review is blocked with a hint when Orca has no repo for the MR project', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)

  const { worker } = await startWorker(fakes)

  const [card] = (await worker.request('rr.snapshot')).reviewRequests
  assert.equal(card!.startBlocked, 'Add acme/api to Orca to review here.')
  await worker.deactivate()
})

test('a broken orca CLI disables only the workspace features; the Review Requests still show', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.failNext(new OrcaCliError('unavailable', 'orca CLI not found'))

  const { host, worker } = await startWorker(fakes)

  const [card] = (await worker.request('rr.snapshot')).reviewRequests
  assert.equal(card!.title, 'Add login')
  assert.equal(card!.workspace, null)
  assert.match(card!.startBlocked ?? '', /orca CLI not found/)
  const bar = lastStatusBar(host)!
  assert.equal(bar.text, '1')
  await worker.deactivate()
})

test('Start review creates a workspace based on the target branch, at the MR head, linked to the MR, and opens it, without an agent', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes, { workspaces: ['/src/api', '/worktrees/review-api-7'] })

  const answer = await worker.request('rr.startReview', { url: MR_URL, withAgent: false })

  assert.deepEqual(fakes.git.fetches, [
    { repoPath: '/src/api', branch: 'main' },
    { repoPath: '/src/api', iid: 7 }
  ])
  const create = fakes.cli.calls.find((c) => c.command === 'worktree create')
  assert.deepEqual(create?.args, {
    name: 'review-api-7',
    repo: `id:${REPO.repoId}`,
    baseBranch: 'origin/main',
    gitlabMr: MR_URL,
    noParent: true,
    setup: 'skip'
  })
  const detail = await fakes.cli.showWorktree(`path:/worktrees/review-api-7`)
  assert.equal(detail.baseRef, 'origin/main')
  assert.deepEqual(fakes.git.resets, [
    { worktreePath: '/worktrees/review-api-7', ref: 'refs/remotes/origin/merge-requests/7' }
  ])
  // Created as review-api-7 (Orca's branch and folder), then shown as "REVIEW <MR title>".
  assert.deepEqual(fakes.cli.calls.find((c) => c.command === 'worktree set')?.args, {
    selector: 'id:repo-api::/worktrees/review-api-7',
    displayName: 'REVIEW Add login'
  })
  assert.equal(answer.reviewRequests[0]!.workspace?.name, 'REVIEW Add login')
  // Orca switches to the new workspace, then shows its Review Cover Page in front.
  const opens = host.calls.map((c) => c.method).filter((m) => m === 'workspace.open' || m === 'editor.open')
  assert.deepEqual(opens, ['workspace.open', 'editor.open'])
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'ws-1' }])
  assert.equal(agentLaunches(fakes).length, 0)
  assert.equal(host.callsOf('terminal.create').length, 0)
  const pushed = worker.posts.filter((p) => p.event === 'rr.changed').at(-1)?.payload as {
    reviewRequests: { workspace?: { name: string } | null }[]
  }
  assert.equal(pushed.reviewRequests[0]!.workspace?.name, 'REVIEW Add login')
  await worker.deactivate()
})

test('Start review with an Agent Review launches the Review Agent in the new workspace with the Review Prompt', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes, {
    settings: { reviewAgent: 'codex', reviewPrompt: 'Review {mrUrl} ({sourceBranch} → {targetBranch})' },
    workspaces: ['/src/api', '/worktrees/review-api-7']
  })

  await worker.request('rr.startReview', { url: MR_URL, withAgent: true })

  assert.deepEqual(agentLaunches(fakes), [
    {
      worktree: 'id:repo-api::/worktrees/review-api-7',
      agent: 'codex',
      prompt: `Review ${MR_URL} (feature/login → main)`,
      focus: false
    }
  ])
  assert.equal(host.callsOf('agent.launch').length, 0, 'never the host API: it drops the prompt')
  await worker.deactivate()
})

test('with a custom review command, the Agent Review runs it in a new terminal instead of launching the agent', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes, {
    settings: { reviewPrompt: 'Review {title}', reviewCommand: 'claude --model opus {prompt}' },
    workspaces: ['/worktrees/review-api-7']
  })

  await worker.request('rr.startReview', { url: MR_URL, withAgent: true })

  assert.deepEqual(host.callsOf('terminal.create'), [
    { workspaceId: 'ws-0', title: 'Agent Review', command: `claude --model opus 'Review Add login'` }
  ])
  assert.equal(agentLaunches(fakes).length, 0)
  await worker.deactivate()
})

test("an Agent Finding's file opens in the Review Workspace at its line, with `orca file open`", async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'by-hand', repoId: REPO.repoId, path: '/wt/by-hand', references: [MR_URL] })
  const { worker } = await startWorker(fakes, { workspaces: ['/src/api', '/wt/by-hand'] })

  assert.deepEqual(await worker.request('rr.openFile', { url: MR_URL, path: 'src/login.ts', line: 48 }), { opened: true })
  await worker.request('rr.openFile', { url: MR_URL, path: 'README.md', line: null })

  assert.deepEqual(
    fakes.cli.calls.filter((c) => c.command === 'file open').map((c) => c.args),
    [
      { worktree: 'id:repo-api::/wt/by-hand', path: 'src/login.ts', line: 48 },
      { worktree: 'id:repo-api::/wt/by-hand', path: 'README.md' }
    ]
  )
  await worker.deactivate()
})

test('Open workspace and Run Agent Review act on the existing Review Workspace', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'by-hand', repoId: REPO.repoId, path: '/wt/by-hand', references: [MR_URL] })
  const { host, worker } = await startWorker(fakes, { workspaces: ['/src/api', '/wt/by-hand'] })

  assert.deepEqual(await worker.request('rr.openWorkspace', { url: MR_URL }), { opened: true })
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'ws-1' }])

  assert.deepEqual(await worker.request('rr.runAgentReview', { url: MR_URL }), { started: true })
  assert.deepEqual(
    agentLaunches(fakes).map((a) => ({ ...(a as object), prompt: undefined })),
    [{ worktree: 'id:repo-api::/wt/by-hand', agent: 'claude', prompt: undefined, focus: true }],
    'Run Agent Review brings the agent terminal to the front'
  )
  assert.equal(host.callsOf('workspace.open').length, 2, 'Run Agent Review switches to the workspace too')
  assert.equal(fakes.cli.calls.filter((c) => c.command === 'worktree create').length, 0)
  await worker.deactivate()
})

test('Start review on a Review Request that already has a workspace creates no second one', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'by-hand', repoId: REPO.repoId, path: '/wt/by-hand', references: [MR_URL] })
  const { host, worker } = await startWorker(fakes, { workspaces: ['/wt/by-hand'] })

  await worker.request('rr.startReview', { url: MR_URL, withAgent: true })

  assert.equal(fakes.cli.calls.filter((c) => c.command === 'worktree create').length, 0)
  assert.equal(agentLaunches(fakes).length, 1)
  await worker.deactivate()
})

test('Start review fails with the reason when Orca has no repo, the fetch fails or Orca refuses', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  const { worker } = await startWorker(fakes)

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: false }), (error) =>
    /Add acme\/api to Orca/.test(String(error))
  )

  fakes.cli.addRepo(REPO)
  fakes.git.failNextOf('fetchBranch', new Error('git fetch of the target branch main failed: no such ref'))
  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: false }), (error) =>
    /git fetch of the target branch main failed: no such ref/.test(String(error))
  )

  fakes.git.failNextOf('fetchMergeRequestHead', new Error('git fetch of the MR failed: no such ref'))
  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: false }), (error) =>
    /git fetch of the MR failed: no such ref/.test(String(error))
  )

  const gone = 'https://gitlab.example.com/acme/api/-/merge_requests/99'
  await assert.rejects(worker.request('rr.startReview', { url: gone, withAgent: false }), (error) =>
    /no longer listed/.test(String(error))
  )
  assert.equal(fakes.cli.calls.filter((c) => c.command === 'worktree create').length, 0)
  await worker.deactivate()
})

test('when the agent does not start, Start review says the workspace is ready anyway', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { worker } = await startWorker(fakes, { workspaces: ['/src/api', '/worktrees/review-api-7'] })
  fakes.cli.launchAgent = async () => {
    throw new OrcaCliError('agent_not_found', 'No agent named claude')
  }

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: true }), (error) =>
    /workspace is ready, but the Agent Review didn't start: No agent named claude/i.test(String(error))
  )
  const [card] = (await worker.request('rr.snapshot')).reviewRequests
  assert.equal(card!.workspace?.name, 'REVIEW Add login')
  await worker.deactivate()
})

test('when Orca refuses the new name, Start review still succeeds with the workspace under its created name', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { worker } = await startWorker(fakes, { workspaces: ['/src/api', '/worktrees/review-api-7'] })
  const setDisplayName = fakes.cli.setDisplayName.bind(fakes.cli)
  fakes.cli.setDisplayName = async () => {
    throw new OrcaCliError('invalid_argument', 'no')
  }

  const answer = await worker.request('rr.startReview', { url: MR_URL, withAgent: false })
  assert.equal(answer.reviewRequests[0]!.workspace?.name, 'review-api-7')
  fakes.cli.setDisplayName = setDisplayName
  await worker.deactivate()
})

test('when the reset to the MR head fails, Start review removes the new workspace and says why', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes, { workspaces: ['/src/api', '/worktrees/review-api-7'] })
  fakes.git.failNextOf('resetBranch', new Error('git reset failed: unknown revision.'))

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: true }), (error) =>
    String(error).includes(
      "Couldn't check out the merge request in the new Review Workspace review-api-7: git reset failed: unknown revision. The workspace was removed; start the review again."
    )
  )
  assert.deepEqual(fakes.cli.calls.find((c) => c.command === 'worktree rm')?.args, {
    selector: `id:${REPO.repoId}::/worktrees/review-api-7`,
    force: true,
    deleteBranch: true
  })
  const [card] = (await worker.request('rr.snapshot')).reviewRequests
  assert.equal(card!.workspace, null)
  assert.equal(agentLaunches(fakes).length, 0)
  await worker.deactivate()
})

test('when the reset fails and the removal fails too, Start review says to remove the workspace by hand', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { worker } = await startWorker(fakes)
  fakes.git.failNextOf('resetBranch', new Error('git reset failed: unknown revision'))
  const create = fakes.cli.createWorktree.bind(fakes.cli)
  fakes.cli.createWorktree = async (input) => {
    const created = await create(input)
    fakes.cli.failNext(new OrcaCliError('worktree_locked', 'worktree is locked'))
    return created
  }

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: false }), (error) =>
    /unknown revision.*Removing it failed too \(worktree is locked\); remove it in Orca/.test(String(error))
  )
  await worker.deactivate()
})

test('a second Start review while the first is still running reuses it: one workspace, one agent', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes, { workspaces: ['/src/api', '/worktrees/review-api-7'] })

  await Promise.all([
    worker.request('rr.startReview', { url: MR_URL, withAgent: true }),
    worker.request('rr.startReview', { url: MR_URL, withAgent: true })
  ])

  assert.equal(fakes.cli.calls.filter((c) => c.command === 'worktree create').length, 1)
  assert.equal(agentLaunches(fakes).length, 1)
  await worker.deactivate()
})

test('Start review on a Review Workspace still at the target branch (reset never ran) resets it when clean', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: '/wt/review-api-7', references: [MR_URL] })
  fakes.git.setHead('/wt/review-api-7', 'target-sha')
  fakes.git.setRef('/wt/review-api-7', 'refs/remotes/origin/main', 'target-sha')
  const { host, worker } = await startWorker(fakes, { workspaces: ['/wt/review-api-7'] })

  await worker.request('rr.startReview', { url: MR_URL, withAgent: true })

  assert.deepEqual(fakes.git.resets, [{ worktreePath: '/wt/review-api-7', ref: 'refs/remotes/origin/merge-requests/7' }])
  assert.equal(fakes.cli.calls.filter((c) => c.command === 'worktree create').length, 0)
  assert.equal(agentLaunches(fakes).length, 1)
  await worker.deactivate()
})

test('Start review on a Review Workspace still at the target branch with changes fails and leaves it alone', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: '/wt/review-api-7', references: [MR_URL] })
  fakes.git.setHead('/wt/review-api-7', 'target-sha')
  fakes.git.setRef('/wt/review-api-7', 'refs/remotes/origin/main', 'target-sha')
  fakes.git.setStatus('/wt/review-api-7', [' M src/a.ts'])
  const { host, worker } = await startWorker(fakes, { workspaces: ['/wt/review-api-7'] })

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: true }), (error) =>
    /review-api-7 is still at the target branch main and has uncommitted changes/.test(String(error))
  )
  assert.deepEqual(fakes.git.resets, [])
  assert.equal(agentLaunches(fakes).length, 0)
  await worker.deactivate()
})

test('Start review leaves a Review Workspace at the MR head alone', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: '/wt/review-api-7', references: [MR_URL] })
  fakes.git.setHead('/wt/review-api-7', 'mr-sha')
  fakes.git.setRef('/wt/review-api-7', 'refs/remotes/origin/main', 'target-sha')
  const { host, worker } = await startWorker(fakes, { workspaces: ['/wt/review-api-7'] })

  await worker.request('rr.startReview', { url: MR_URL, withAgent: true })

  assert.deepEqual(fakes.git.resets, [])
  assert.deepEqual(fakes.git.fetches, [{ repoPath: '/wt/review-api-7', branch: 'main' }], 'only the base, fresh')
  assert.equal(agentLaunches(fakes).length, 1)
  await worker.deactivate()
})

/** The worker on an existing Review Workspace, recording the fetches made before each agent launch. */
async function existingWorkspace(fakes: Fakes, targetBranch = 'main') {
  fakes.gitlab.addMergeRequest({
    projectPath: 'acme/api',
    iid: 7,
    title: 'Add login',
    author: 'ada',
    sourceBranch: 'feature/login',
    targetBranch
  })
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'review-api-7', repoId: REPO.repoId, path: '/wt/review-api-7', references: [MR_URL] })
  const fetchesAtLaunch: unknown[][] = []
  const settings = { ...CONFIGURED }
  const host = mockHost({
    settings,
    results: {
      'workspace.list': workspaceList('/wt/review-api-7'),
      'workspace.open': { opened: true },
      'editor.open': { opened: true }
    }
  })
  const launch = fakes.cli.launchAgent.bind(fakes.cli)
  fakes.cli.launchAgent = async (input) => {
    fetchesAtLaunch.push([...fakes.git.fetches])
    return launch(input)
  }
  const { worker } = await startHarness(fakes, settings, host)
  return { host, worker, fetchesAtLaunch }
}

test('an Agent Review on an existing workspace fetches the target branch fresh first: its base (#56)', async () => {
  const fakes = fakeDeps()
  const { worker, fetchesAtLaunch } = await existingWorkspace(fakes)

  await worker.request('rr.startReview', { url: MR_URL, withAgent: true })
  await worker.request('rr.runAgentReview', { url: MR_URL })

  const base = { repoPath: '/wt/review-api-7', branch: 'main' }
  assert.deepEqual(fetchesAtLaunch, [[base], [base, base]])
  await worker.deactivate()
})

test('Start review without an Agent Review on an existing workspace fetches nothing', async () => {
  const fakes = fakeDeps()
  const { worker } = await existingWorkspace(fakes)

  await worker.request('rr.startReview', { url: MR_URL, withAgent: false })

  assert.deepEqual(fakes.git.fetches, [])
  await worker.deactivate()
})

test("a failed fetch of the target branch doesn't hold the Agent Review back when the base is there (#56)", async () => {
  const fakes = fakeDeps()
  fakes.git.setRef('/wt/review-api-7', 'refs/remotes/origin/main', 'target-sha')
  const { host, worker } = await existingWorkspace(fakes)
  fakes.git.failNextOf('fetchBranch', new Error('git fetch of the target branch main failed: offline'))

  assert.deepEqual(await worker.request('rr.runAgentReview', { url: MR_URL }), { started: true })

  assert.equal(agentLaunches(fakes).length, 1)
  await worker.deactivate()
})

test('when the fetch fails and there is no base to diff against, the Agent Review says why (#56)', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await existingWorkspace(fakes)

  fakes.git.failNextOf('fetchBranch', new Error('git fetch of the target branch main failed: offline'))
  await assert.rejects(worker.request('rr.runAgentReview', { url: MR_URL }), (error) =>
    /target branch main failed: offline/.test(String(error))
  )
  fakes.git.failNextOf('fetchBranch', new Error('git fetch of the target branch main failed: offline'))
  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: true }), (error) =>
    /Review Workspace is ready, but the Agent Review didn't start: .*target branch main failed: offline/.test(
      String(error)
    )
  )
  assert.equal(agentLaunches(fakes).length, 0)
  await worker.deactivate()
})

test('an Agent Review refuses a Review Request without a target branch: its diff would be empty (#56)', async () => {
  const fakes = fakeDeps()
  const { host, worker } = await existingWorkspace(fakes, '')

  await assert.rejects(worker.request('rr.runAgentReview', { url: MR_URL }), (error) =>
    /This Review Request has no target branch yet\. Refresh and try again\./.test(String(error))
  )
  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: true }), (error) =>
    /the Agent Review didn't start: This Review Request has no target branch yet/.test(String(error))
  )
  assert.equal(agentLaunches(fakes).length, 0)
  await worker.deactivate()
})

test('with a setup command, Start review runs it in a Setup terminal of the new workspace, at the MR head', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  const { host, worker } = await startWorker(fakes, {
    settings: { setupCommand: ' pnpm install ' },
    workspaces: ['/src/api', '/worktrees/review-api-7']
  })

  await worker.request('rr.startReview', { url: MR_URL, withAgent: false })

  assert.deepEqual(host.callsOf('terminal.create'), [{ workspaceId: 'ws-1', title: 'Setup', command: 'pnpm install' }])
  assert.equal(fakes.git.resets.length, 1, 'the workspace was moved to the MR head first')
  await worker.deactivate()
})

test('the setup command runs only in a workspace Start review makes, and not when blank', async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  fakes.cli.addWorktree({ name: 'by-hand', repoId: REPO.repoId, path: '/wt/by-hand', references: [MR_URL] })
  const existing = await startWorker(fakes, { settings: { setupCommand: 'pnpm install' }, workspaces: ['/wt/by-hand'] })
  await existing.worker.request('rr.startReview', { url: MR_URL, withAgent: false })
  assert.equal(existing.host.callsOf('terminal.create').length, 0)
  await existing.worker.deactivate()

  const blank = fakeDeps()
  addReviewRequest(blank)
  blank.cli.addRepo(REPO)
  const created = await startWorker(blank, { workspaces: ['/src/api', '/worktrees/review-api-7'] })
  await created.worker.request('rr.startReview', { url: MR_URL, withAgent: false })
  assert.equal(created.host.callsOf('terminal.create').length, 0)
  await created.worker.deactivate()
})

test("when the setup command can't start, Start review says the workspace is ready anyway", async () => {
  const fakes = fakeDeps()
  addReviewRequest(fakes)
  fakes.cli.addRepo(REPO)
  // workspace.list does not know the new workspace (yet): no terminal can open in it.
  const { worker } = await startWorker(fakes, { settings: { setupCommand: 'pnpm install' }, workspaces: ['/src/api'] })

  await assert.rejects(worker.request('rr.startReview', { url: MR_URL, withAgent: false }), (error) =>
    /Review Workspace is ready, but .*the setup command didn't start: Orca doesn't list the workspace/.test(String(error))
  )
  await worker.deactivate()
})
