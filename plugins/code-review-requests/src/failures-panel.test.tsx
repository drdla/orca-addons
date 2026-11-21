// The panel's failure states (#24): for Needs you, a warning above the tabs that opens the
// Settings view, where the setup checklist is; the "Couldn't refresh" line over the last list for
// transient failures.
import { assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import type { GitLabProblemView, ReviewRequestsSnapshot } from './protocol'

const NOW = Date.UTC(2026, 10, 16, 9, 0, 0)

function needsYou(over: Partial<Extract<GitLabProblemView, { status: 'needs-you' }>> = {}): ReviewRequestsSnapshot {
  return {
    reviewRequests: [],
    refreshedAt: null,
    gitlab: {
      status: 'needs-you',
      reason: 'logged-out',
      host: 'gitlab.example.com',
      version: null,
      message: 'gitlab.example.com: 401 Unauthorized',
      ...over
    }
  }
}

function retrying(over: Partial<Extract<GitLabProblemView, { status: 'retrying' }>> = {}): ReviewRequestsSnapshot {
  return {
    reviewRequests: [],
    refreshedAt: null,
    gitlab: {
      status: 'retrying',
      message: 'gitlab.example.com: 503 Service Unavailable',
      lastSuccessAt: NOW - 14 * 60_000,
      retryAt: NOW + 60_000,
      rateLimitedUntil: null,
      offline: false,
      ...over
    }
  }
}

async function openSettings(view: TestPanel): Promise<void> {
  await view.press(view.find({ type: 'IconButton', label: 'Settings' })!)
}

test('Needs you warns above the tabs, and Open Settings leads to the setup checklist', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'rr.snapshot': needsYou() } }) })

  const warning = view.find({ type: 'Callout', text: /GitLab connection needs attention/ })
  assert.ok(warning)
  assert.match(warning!.text, /glab is not logged in to gitlab\.example\.com/)
  assert.ok(view.find({ type: 'Tabs' }))
  assert.equal(view.find({ type: 'Callout', text: /Connect GitLab/ }), null)

  await view.press(view.find({ type: 'Button', text: 'Open Settings' })!)
  assert.ok(view.find({ type: 'Heading', text: 'Settings' }))
  assert.ok(view.find({ type: 'Callout', text: /Connect GitLab/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Needs you shows the setup checklist with the glab login command for the host', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'rr.snapshot': needsYou() } }) })
  await openSettings(view)

  assert.ok(view.find({ type: 'Callout', text: /Connect GitLab/ }))
  assert.ok(view.find({ text: /glab is not logged in to gitlab\.example\.com/ }))
  assert.ok(view.find({ type: 'Code', text: 'glab auth login --hostname gitlab.example.com' }))
  assert.ok(view.find({ type: 'Button', text: 'Check again' }))
  assert.equal(view.find({ type: 'EmptyState' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Check again asks the worker to retry and shows what it answers', async () => {
  let retries = 0
  const host = mockHost({
    requests: {
      'rr.snapshot': needsYou(),
      'rr.refresh': () => {
        retries++
        return { reviewRequests: [], refreshedAt: NOW }
      }
    }
  })
  const view = await mount(panel, { host })
  await openSettings(view)

  await view.press(view.find({ type: 'Button', text: 'Check again' })!)

  assert.equal(retries, 1)
  assert.equal(view.find({ type: 'Callout', text: /Connect GitLab/ }), null)
  await view.press(view.find({ type: 'Button', text: /Back/ })!)
  assert.equal(view.find({ type: 'Callout', text: /GitLab connection needs attention/ }), null)
  assert.ok(view.find({ text: 'No open review requests' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Copy puts the glab login command on the clipboard', async () => {
  const copied: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': needsYou(),
      'rr.copyText': ({ text }: { text: string }) => {
        copied.push(text)
        return { copied: true }
      }
    }
  })
  const view = await mount(panel, { host })
  await openSettings(view)

  await view.press(view.find({ type: 'IconButton', label: 'Copy the glab login command' })!)

  assert.deepEqual(copied, ['glab auth login --hostname gitlab.example.com'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('logged out here but in to other hosts: one click switches the instance URL to one of them', async () => {
  const used: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': needsYou({ glabHosts: ['gitlab.com', 'gitlab.other.com'] }),
      'rr.useHost': ({ host: picked }: { host: string }) => {
        used.push(picked)
        return { reviewRequests: [], refreshedAt: NOW }
      }
    }
  })
  const view = await mount(panel, { host })
  await openSettings(view)

  assert.ok(view.find({ type: 'Button', text: 'Use gitlab.com' }))
  await view.press(view.find({ type: 'Button', text: 'Use gitlab.other.com' })!)

  assert.deepEqual(used, ['gitlab.other.com'])
  assert.equal(view.find({ type: 'Callout', text: /Connect GitLab/ }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the checklist names the missing step for each kind of Needs you', async () => {
  const cases: [Partial<Extract<GitLabProblemView, { status: 'needs-you' }>>, RegExp][] = [
    [{ reason: 'glab-missing' }, /brew install glab/],
    [{ reason: 'token-rejected' }, /Token rejected \(expired or revoked\)/],
    [{ reason: 'gitlab-too-old', version: '17.2.0' }, /Needs GitLab 17\.4\+, this instance runs 17\.2\.0/],
    [{ reason: 'bad-url', host: null }, /instance URL/]
  ]
  for (const [problem, text] of cases) {
    const view = await mount(panel, { host: mockHost({ requests: { 'rr.snapshot': needsYou(problem) } }) })
    await openSettings(view)
    assert.ok(view.find({ text }), `${problem.reason}: ${text}`)
    assert.deepEqual(view.errors, [])
    await view.unmount()
  }
})

test('the raw error is behind a Details disclosure', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'rr.snapshot': needsYou() } }) })
  await openSettings(view)

  assert.equal(view.find({ type: 'Code', text: 'gitlab.example.com: 401 Unauthorized' }), null)
  await view.toggle(view.find({ type: 'Collapsible' })!)
  assert.ok(view.find({ type: 'Code', text: 'gitlab.example.com: 401 Unauthorized' }))
  await view.unmount()
})

test('a transient failure says it couldn’t refresh, keeps the list, and offers Retry', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'rr.snapshot': retrying() } }) })

  assert.ok(view.find({ text: /Couldn't refresh/ }))
  assert.ok(view.find({ text: /last updated \d+[mhd] ago/ }))
  assert.equal(view.find({ type: 'RelativeTime' }), null)
  const retry = view.find({ type: 'Button', text: 'Retry' })
  assert.ok(retry)
  assert.equal(retry!.disabled, false)
  assert.ok(view.find({ text: 'No open review requests' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('while rate-limited, Retry is disabled and says until when', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': retrying({ rateLimitedUntil: '09:10' }) } })
  })

  const button = view.find({ type: 'Button', text: 'Rate-limited until 09:10' })
  assert.ok(button)
  assert.equal(button!.disabled, true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
