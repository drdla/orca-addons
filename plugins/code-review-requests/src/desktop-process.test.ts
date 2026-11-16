// The real Desktop's one piece of logic: which installed plugin key is this plugin's.
import { assert, test } from 'orca/testing'
import { pluginKeyFrom } from './desktop-process'

const listed = (plugins: { pluginKey: string; isDev?: boolean }[]) => JSON.stringify({ ok: true, result: { plugins } })

test('finds this plugin by its id, whoever published it', () => {
  const out = listed([{ pluginKey: 'acme.other' }, { pluginKey: 'drdla.code-review-requests' }])
  assert.equal(pluginKeyFrom(out), 'drdla.code-review-requests')
})

test('prefers the dev copy while one is loaded', () => {
  const out = listed([
    { pluginKey: 'drdla.code-review-requests', isDev: false },
    { pluginKey: 'local.code-review-requests', isDev: true }
  ])
  assert.equal(pluginKeyFrom(out), 'local.code-review-requests')
})

test('has no key when the plugin is not listed or the output is not JSON', () => {
  assert.equal(pluginKeyFrom(listed([{ pluginKey: 'acme.code-review-requests-extra' }])), null)
  assert.equal(pluginKeyFrom('not json'), null)
})
