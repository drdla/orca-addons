// The panel's Connection section and token entry (#8, #25): the active source, the signed-in user
// and what the scopes allow, and saving, replacing or removing a token, both in the Connection
// section and in the setup checklist's second path. Tokens here are made-up strings.
import { assert, mockHost, mount, test } from 'orca/testing'
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

test('when healthy, the Connection section is collapsed and names the source and the user', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': healthy, 'rr.connection': connection() } })
  })

  const section = view.find({ type: 'Collapsible', label: 'Connection' })
  assert.ok(section)
  assert.equal(view.valueOf(section), false)
  assert.match(String(section.props.description), /glab · signed in as me/)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
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

  await view.toggle(view.find({ type: 'Collapsible', label: 'Connection' })!)

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
  await view.toggle(view.find({ type: 'Collapsible', label: 'Connection' })!)

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
  await view.toggle(view.find({ type: 'Collapsible', label: 'Connection' })!)

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
  await view.toggle(view.find({ type: 'Collapsible', label: 'Connection' })!)

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
  await view.toggle(view.find({ type: 'Collapsible', label: 'Connection' })!)

  assert.equal(view.find({ type: 'Input', label: 'Use a token instead' })?.props.disabled, true)
  assert.ok(view.find({ text: /only glab works/i }))
  await view.unmount()
})

test('while the connection fails, the section is open and shows the problem', async () => {
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'rr.snapshot': { ...healthy, gitlab: { status: 'retrying', message: 'x: 503', lastSuccessAt: null, retryAt: null, rateLimitedUntil: null, offline: true } },
        'rr.connection': connection({ user: null, canList: null, problem: 'No response from gitlab.example.com' })
      }
    })
  })

  assert.equal(view.valueOf(view.find({ type: 'Collapsible', label: 'Connection' })!), true)
  assert.ok(view.find({ text: /No response from gitlab\.example\.com/ }))
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

  assert.ok(view.find({ type: 'Code', text: 'glab auth login --hostname gitlab.example.com' }))
  const link = view.find({ type: 'Link', text: /Create a token/ })
  assert.equal(
    link?.props.href,
    'https://gitlab.example.com/-/user_settings/personal_access_tokens?scopes=read_api,api&name=Orca+Review+Requests'
  )
  await view.type(view.find({ type: 'Input', label: 'Use a token instead' })!, TOKEN)
  await view.press(view.find({ type: 'Button', text: 'Save token' })!)
  assert.deepEqual(saved, [TOKEN])
  assert.equal(view.find({ type: 'Collapsible', label: 'Connection' }), null)
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

  assert.ok(view.find({ text: /Token rejected \(expired or revoked\)/ }))
  assert.ok(view.find({ type: 'Input', label: 'Replace token' }))
  await view.press(view.find({ type: 'Button', text: 'Remove token' })!)
  assert.equal(removed, 1)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
