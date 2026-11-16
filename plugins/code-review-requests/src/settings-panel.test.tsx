// The panel's Settings view: the gear next to Refresh opens it, Back returns to the tabs. It shows
// the connection first, then every setting the manifest declares, saved through settings:own so
// Orca's Settings page shows the same values.
import { readFileSync } from 'node:fs'
import { assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel'
import type { ReviewRequestsSnapshot } from './protocol'

const NOW = Date.UTC(2026, 10, 16, 9, 0)
const healthy: ReviewRequestsSnapshot = { reviewRequests: [], refreshedAt: NOW }

test('the gear opens Settings, and Back returns to the tab that was selected', async () => {
  const view = await mount(panel, {
    host: mockHost({ requests: { 'rr.snapshot': healthy } }),
    persisted: { plugin: { 'rr.tab': 'in' } }
  })

  await view.press(view.find({ type: 'IconButton', label: 'Settings' })!)
  assert.ok(view.find({ type: 'Heading', text: 'Settings' }))
  assert.equal(view.find({ type: 'Tabs' }), null)

  await view.press(view.find({ type: 'Button', text: /Back/ })!)
  assert.equal(view.find({ type: 'Heading', text: 'Settings' }), null)
  assert.equal(view.valueOf(view.find({ type: 'Tabs' })!), 'in')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

type DeclaredSetting = { key: string; title: string; description?: string; multiline?: boolean }

function declaredSettings(): DeclaredSetting[] {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as {
    contributes: { settings: DeclaredSetting[] }
  }
  return manifest.contributes.settings
}

async function openSettingsView(
  options: { settings?: Record<string, string | number>; snapshot?: ReviewRequestsSnapshot } = {}
) {
  const host = mockHost({ settings: options.settings ?? {}, requests: { 'rr.snapshot': options.snapshot ?? healthy } })
  const view = await mount(panel, { host })
  await view.press(view.find({ type: 'IconButton', label: 'Settings' })!)
  return view
}

test('Settings shows every declared setting with its title, description and a fitting control', async () => {
  const view = await openSettingsView()

  for (const setting of declaredSettings()) {
    const type = setting.multiline === true ? 'Textarea' : 'Input'
    assert.ok(view.find({ type, label: setting.title }), `${setting.key}: a ${type} labelled "${setting.title}"`)
    if (setting.description !== undefined) {
      assert.equal(view.find({ type: 'Field', label: setting.title })?.props.description, setting.description)
    }
  }
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('each field shows the stored value, or the default when none is stored', async () => {
  const view = await openSettingsView({ settings: { instanceUrl: 'https://gitlab.acme.dev', pollMinutes: 10 } })

  assert.equal(view.valueOf(view.find({ type: 'Input', label: 'GitLab instance URL' })!), 'https://gitlab.acme.dev')
  assert.equal(view.valueOf(view.find({ type: 'Input', label: 'Refresh every (minutes)' })!), '10')
  assert.equal(view.valueOf(view.find({ type: 'Input', label: 'Overdue after (working hours)' })!), '24')
  assert.equal(view.valueOf(view.find({ type: 'Input', label: 'Review agent' })!), 'claude')
  await view.unmount()
})

test('a text setting is saved with Enter, and a number setting with Save, as the type Orca declares', async () => {
  const view = await openSettingsView()

  await view.type(view.find({ type: 'Input', label: 'GitLab instance URL' })!, 'https://gitlab.acme.dev', {
    replace: true,
    submit: true
  })
  await view.type(view.find({ type: 'Input', label: 'Refresh every (minutes)' })!, '15', { replace: true })
  assert.equal(view.host.data().settings.pollMinutes, undefined, 'nothing is saved while typing')
  await view.press(view.find({ type: 'Button', text: 'Save' })!)

  assert.equal(view.host.data().settings.instanceUrl, 'https://gitlab.acme.dev')
  assert.equal(view.host.data().settings.pollMinutes, 15)
  assert.equal(view.find({ type: 'Button', text: 'Save' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a multiline setting is a textarea, saved with Save', async () => {
  const view = await openSettingsView()

  await view.type(view.find({ type: 'Textarea', label: 'Never these authors' })!, 'renovate-bot\n@dependabot', {
    replace: true
  })
  await view.press(view.find({ type: 'Button', text: 'Save' })!)

  assert.equal(view.host.data().settings.authorBlocklist, 'renovate-bot\n@dependabot')
  await view.unmount()
})

test('a number outside its limits is not saved, and the field says why', async () => {
  const view = await openSettingsView({ settings: { pollMinutes: 5 } })

  await view.type(view.find({ type: 'Input', label: 'Refresh every (minutes)' })!, '0', { replace: true, submit: true })

  assert.equal(view.host.data().settings.pollMinutes, 5)
  assert.equal(view.find({ type: 'Field', label: 'Refresh every (minutes)' })?.props.error, 'Enter a whole number from 1 to 1440.')
  assert.equal(view.find({ type: 'Input', label: 'Refresh every (minutes)' })?.props.invalid, true)
  await view.unmount()
})

test('a setting changed elsewhere (Orca Settings, the worker) shows in the view', async () => {
  const host = mockHost({ requests: { 'rr.snapshot': healthy } })
  const view = await mount(panel, { host })
  await view.press(view.find({ type: 'IconButton', label: 'Settings' })!)
  const worker = await mountWorker(
    {
      default: (orca) => {
        orca.panels.handle('test.setSetting' as never, (async ({ key, value }: { key: string; value: string }) => {
          await orca.settings.set(key, value)
          return null
        }) as never)
      }
    },
    { host }
  )

  await worker.request('test.setSetting' as never, { key: 'reviewAgent', value: 'codex' } as never)
  await view.settled()

  assert.equal(view.valueOf(view.find({ type: 'Input', label: 'Review agent' })!), 'codex')
  await worker.deactivate()
  await view.unmount()
})

test('filter entries the worker ignores are named under the filter settings', async () => {
  const view = await openSettingsView({ snapshot: { ...healthy, invalidFilterEntries: ['acme//api', 'no!'] } })

  assert.ok(view.find({ text: /ignored.*acme\/\/api, no!/ }))
  await view.unmount()
})

test('the list says nothing about the connection while it is healthy, and Settings has no checklist', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'rr.snapshot': healthy } }) })

  assert.equal(view.find({ type: 'Callout' }), null)
  await view.press(view.find({ type: 'IconButton', label: 'Settings' })!)
  assert.equal(view.find({ type: 'Callout', text: /Connect GitLab/ }), null)
  await view.unmount()
})
