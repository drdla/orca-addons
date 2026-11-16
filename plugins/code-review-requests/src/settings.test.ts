import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { DEFAULT_SETTINGS, parseSettingInput, readSettings, SETTING_FIELDS } from './settings'

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

test("the panel's Settings fields are the manifest's settings, in its order, with its words and limits", () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as {
    contributes: { settings: Record<string, unknown>[] }
  }
  const declared = manifest.contributes.settings.map((s) => ({
    key: s.key,
    title: s.title,
    description: s.description,
    placeholder: s.placeholder,
    control: s.type === 'integer' ? 'integer' : s.multiline === true ? 'multiline' : 'text',
    minimum: s.minimum,
    maximum: s.maximum
  }))
  const fields = SETTING_FIELDS.map((f) => ({
    key: f.key,
    title: f.title,
    description: f.description,
    placeholder: f.placeholder,
    control: f.control,
    minimum: f.minimum,
    maximum: f.maximum
  }))
  assert.deepEqual(fields, declared)
})

test('a typed setting value is checked against its field before it is saved', () => {
  const poll = SETTING_FIELDS.find((f) => f.key === 'pollMinutes')!
  const url = SETTING_FIELDS.find((f) => f.key === 'instanceUrl')!
  assert.deepEqual(parseSettingInput(poll, ' 15 '), { value: 15 })
  assert.deepEqual(parseSettingInput(poll, '0'), { error: 'Enter a whole number from 1 to 1440.' })
  assert.deepEqual(parseSettingInput(poll, '2.5'), { error: 'Enter a whole number from 1 to 1440.' })
  assert.deepEqual(parseSettingInput(SETTING_FIELDS.find((f) => f.key === 'overdueHours')!, 'soon'), {
    error: 'Enter a whole number, 1 or more.'
  })
  assert.deepEqual(parseSettingInput(url, 'https://gitlab.acme.dev '), { value: 'https://gitlab.acme.dev ' })
})
