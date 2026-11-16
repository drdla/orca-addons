// The Connection part of the panel's Settings view and token entry (#8, #25): the active source,
// the signed-in user and what the scopes allow, and saving, replacing or removing a token, both
// there and in the setup checklist's second path. While the connection is broken, the list shows a
// warning that opens the Settings view. Tokens here are made-up strings.
import { assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import type { ConnectionView, ReviewRequestsSnapshot } from './protocol'

const TOKEN = 'glpat-FAKE-panel-token'
const NOW = Date.UTC(2026, 10, 16, 9, 0)
const healthy: ReviewRequestsSnapshot = { reviewRequests: [], refreshedAt: NOW }

function connection(over: Partial<ConnectionView> = {}): ConnectionView {
  return {
    configured: true,
    host: 'gitlab.example.com',
    source: 'glab',
    user: 'me',
    scopes: null,
    canList: true,
    canPost: null,
    tokenStorage: 'os-keyring',
    problem: null,
    ...over
  }
}

function needsYou(reason: 'logged-out' | 'token-rejected' | 'glab-missing'): ReviewRequestsSnapshot {
  return {
    reviewRequests: [],
    refreshedAt: null,
    gitlab: { status: 'needs-you', reason, host: 'gitlab.example.com', version: null, message: 'gitlab.example.com: 401' }
  }
}

async function openSettings(view: TestPanel): Promise<void> {
  await view.press(view.find({ type: 'IconButton', label: 'Settings' })!)
}

test('when healthy, the list says nothing about the connection', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': healthy, 'rr.connection': connection() } })
  })

  assert.equal(view.find({ text: /Connection|connection/ }), null)
  assert.equal(view.find({ text: /signed in as/ }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('Settings starts with the connection: the source, the user and the host', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': healthy, 'rr.connection': connection() } })
  })
  await openSettings(view)

  assert.ok(view.find({ type: 'Heading', text: 'Connection' }))
  assert.ok(view.find({ text: 'glab · signed in as me' }))
  assert.ok(view.find({ text: /glab, logged in to gitlab\.example\.com/ }))
  assert.ok(view.find({ type: 'Button', text: 'Test connection' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('opened, it shows what the scopes allow, with a hint when posting needs the api scope', async () => {
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'rr.snapshot': healthy,
        'rr.connection': connection({ source: 'token', scopes: ['read_api'], canPost: false })
      }
    })
  })

  await openSettings(view)

  assert.ok(view.find({ text: /Token for gitlab\.example\.com/ }))
  assert.ok(view.find({ text: /Can list ✓ · Can post review ✗/ }))
  assert.ok(view.find({ text: /needs a token with the api scope/ }))
  assert.ok(view.find({ type: 'Button', text: 'Remove token' }))
  assert.ok(view.find({ type: 'Input', label: 'Replace token' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a token is saved through the worker, and the field is cleared once it is stored', async () => {
  const saved: string[] = []
  const host = mockHost({
    requests: {
      'rr.snapshot': healthy,
      'rr.connection': connection(),
      'rr.saveToken': ({ token }) => {
        saved.push(token)
        return { connection: connection({ source: 'token', scopes: ['api', 'read_api'], canPost: true }), error: null }
      }
    }
  })
  const view = await mount(panel, { host })
  await openSettings(view)

  await view.type(view.find({ type: 'Input', label: 'Use a token instead' })!, TOKEN)
  await view.press(view.find({ type: 'Button', text: 'Save token' })!)

  assert.deepEqual(saved, [TOKEN])
  assert.ok(view.find({ text: /Token for gitlab\.example\.com/ }))
  assert.ok(view.find({ text: /Can list ✓ · Can post review ✓/ }))
  assert.ok(!JSON.stringify(view.tree()).includes(TOKEN))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a token the worker refuses shows why, and nothing changes', async () => {
  const host = mockHost({
    requests: {
      'rr.snapshot': healthy,
      'rr.connection': connection(),
      'rr.saveToken': () => ({ connection: connection(), error: 'gitlab.example.com rejected the token. Nothing was saved.' })
    }
  })
  const view = await mount(panel, { host })
  await openSettings(view)

  await view.type(view.find({ type: 'Input', label: 'Use a token instead' })!, TOKEN, { submit: true })

  assert.ok(view.find({ text: /rejected the token\. Nothing was saved\./ }))
  assert.ok(view.find({ text: /^glab/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Remove token goes back to glab, and Test connection re-checks', async () => {
  const asked: unknown[] = []
  let removed = 0
  const host = mockHost({
    requests: {
      'rr.snapshot': healthy,
      'rr.connection': (input) => {
        asked.push(input)
        return connection({ source: 'token', scopes: ['api'], canPost: true })
      },
      'rr.removeToken': () => {
        removed++
        return connection()
      }
    }
  })
  const view = await mount(panel, { host })
  await openSettings(view)

  await view.press(view.find({ type: 'Button', text: 'Test connection' })!)
  assert.deepEqual(asked.at(-1), { test: true })
  await view.press(view.find({ type: 'Button', text: 'Remove token' })!)

  assert.equal(removed, 1)
  assert.ok(view.find({ type: 'Input', label: 'Use a token instead' }))
  assert.equal(view.find({ type: 'Button', text: 'Remove token' }), null)
  await view.unmount()
})

test('without a secure key store, the token field is disabled and says only glab works', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': healthy, 'rr.connection': connection({ tokenStorage: 'unavailable' }) } })
  })
  await openSettings(view)

  assert.equal(view.find({ type: 'Input', label: 'Use a token instead' })?.props.disabled, true)
  assert.ok(view.find({ text: /only glab works/i }))
  await view.unmount()
})

test('while the connection check fails, the list warns above the tabs and Open Settings shows the problem', async () => {
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'rr.snapshot': healthy,
        'rr.connection': connection({ user: null, canList: null, problem: 'gitlab.example.com: 403 Forbidden' })
      }
    })
  })

  const warning = view.find({ type: 'Callout', text: /GitLab connection needs attention/ })
  assert.ok(warning)
  assert.match(warning!.text, /403 Forbidden/)
  assert.ok(view.find({ type: 'Tabs' }))
  await view.press(view.find({ type: 'Button', text: 'Open Settings' })!)

  assert.ok(view.find({ type: 'Heading', text: 'Settings' }))
  assert.ok(view.find({ type: 'Text', text: 'gitlab.example.com: 403 Forbidden' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a transient failure has its own line, not the connection warning', async () => {
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'rr.snapshot': { ...healthy, gitlab: { status: 'retrying', message: 'x: 503', lastSuccessAt: null, retryAt: null, rateLimitedUntil: null, offline: true } },
        'rr.connection': connection({ user: null, canList: null, problem: 'No response from gitlab.example.com' })
      }
    })
  })

  assert.ok(view.find({ type: 'Callout', text: /Can't reach GitLab/ }))
  assert.equal(view.find({ type: 'Callout', text: /GitLab connection needs attention/ }), null)
  await view.unmount()
})

test('the setup checklist offers a token as the second path, with a link that pre-fills the scopes', async () => {
  const saved: string[] = []
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'rr.snapshot': needsYou('logged-out'),
        'rr.connection': connection({ user: null, canList: false }),
        'rr.saveToken': ({ token }) => {
          saved.push(token)
          return { connection: connection({ source: 'token' }), error: null }
        }
      }
    })
  })
  await openSettings(view)

  assert.ok(view.find({ type: 'Code', text: 'glab auth login --hostname gitlab.example.com' }))
  const link = view.find({ type: 'Link', text: /Create a token/ })
  assert.equal(
    link?.props.href,
    'https://gitlab.example.com/-/user_settings/personal_access_tokens?scopes=read_api,api&name=Orca+Review+Requests'
  )
  await view.type(view.find({ type: 'Input', label: 'Use a token instead' })!, TOKEN)
  await view.press(view.find({ type: 'Button', text: 'Save token' })!)
  assert.deepEqual(saved, [TOKEN])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a rejected token can be replaced or removed right in the checklist', async () => {
  let removed = 0
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'rr.snapshot': needsYou('token-rejected'),
        'rr.connection': connection({ source: 'token', user: null, canList: false }),
        'rr.removeToken': () => {
          removed++
          return connection()
        }
      }
    })
  })
  await openSettings(view)

  assert.ok(view.find({ text: /Token rejected \(expired or revoked\)/ }))
  assert.equal(view.findAll({ type: 'Input', label: 'Replace token' }).length, 1)
  await view.press(view.find({ type: 'Button', text: 'Remove token' })!)
  assert.equal(removed, 1)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
