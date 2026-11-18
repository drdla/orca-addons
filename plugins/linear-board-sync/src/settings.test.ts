import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { DEFAULT_SETTINGS, parseSettings } from './settings'

test('the manifest declares every setting with the same default as the code', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as {
    contributes: { settings: { key: string; default: unknown }[] }
  }
  const declared = Object.fromEntries(manifest.contributes.settings.map((s) => [s.key, s.default]))
  assert.deepEqual(declared, DEFAULT_SETTINGS)
})

test('the manifest defaults parse without problems and sync every team by type', () => {
  const parsed = parseSettings(DEFAULT_SETTINGS)
  assert.deepEqual(parsed, { settings: { teams: [], overrides: [] }, pollMinutes: 2, problems: [] })
})
