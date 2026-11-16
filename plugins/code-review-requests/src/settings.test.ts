import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { DEFAULT_SETTINGS, readSettings } from './settings'

function settingsOf(stored: Record<string, unknown>) {
  return { get: async () => stored } as Parameters<typeof readSettings>[0]
}

test('unset settings fall back to the defaults (Orca test hosts apply none)', async () => {
  const settings = await readSettings(settingsOf({}))
  assert.equal(settings.instanceUrl, 'https://gitlab.com')
  assert.equal(settings.pollMinutes, 5)
  assert.equal(settings.overdueHours, 24)
  assert.equal(settings.autoRemoveDays, 2)
  assert.equal(settings.pathAllowlist, '')
})

test('stored settings win, and a value of the wrong type falls back to its default', async () => {
  const settings = await readSettings(
    settingsOf({ pollMinutes: 10, instanceUrl: 'https://gitlab.acme.dev', overdueHours: 'soon' })
  )
  assert.equal(settings.pollMinutes, 10)
  assert.equal(settings.instanceUrl, 'https://gitlab.acme.dev')
  assert.equal(settings.overdueHours, 24)
})

test('the manifest declares every setting with the same default as the code', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as {
    contributes: { settings: { key: string; default?: unknown }[] }
  }
  const declared = Object.fromEntries(manifest.contributes.settings.map((s) => [s.key, s.default]))
  assert.deepEqual(declared, { ...DEFAULT_SETTINGS })
})
