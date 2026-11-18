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

test('the manifest defaults parse without problems, sync every team by type, and write back Todo, In Progress and Blocked', () => {
  const parsed = parseSettings(DEFAULT_SETTINGS)
  assert.deepEqual(parsed, {
    settings: { teams: [], overrides: [], writable: { todo: 'Todo', 'in-progress': 'In Progress', blocked: 'Blocked' } },
    pollMinutes: 2,
    problems: []
  })
})
