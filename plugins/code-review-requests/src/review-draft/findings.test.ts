// The findings.json contract (#29): what an Agent Review writes and which entries the plugin keeps.
import { assert, test } from 'orca/testing'
import { parseFindings } from './findings'

test('reads line, range and general findings plus the reviewed commit', () => {
  const parsed = parseFindings(
    JSON.stringify({
      headSha: 'abc123',
      findings: [
        { path: 'src/login.ts', line: 12, body: 'Check the token expiry.', blocking: true },
        { path: 'src/login.ts', startLine: 20, line: 24, body: 'This block is duplicated.', blocking: 'yes' },
        { body: 'Consider splitting this MR.' }
      ]
    })
  )
  assert.equal(parsed.headSha, 'abc123')
  assert.deepEqual(parsed.findings, [
    { filePath: 'src/login.ts', line: 12, body: 'Check the token expiry.', blocking: true },
    { filePath: 'src/login.ts', startLine: 20, line: 24, body: 'This block is duplicated.', blocking: false },
    { filePath: null, line: null, body: 'Consider splitting this MR.', blocking: false }
  ])
  assert.deepEqual(parsed.warnings, [])
})

test('a bare array of findings is accepted, without a commit', () => {
  const parsed = parseFindings(JSON.stringify([{ path: 'a.ts', line: 1, body: 'x' }]))
  assert.equal(parsed.headSha, null)
  assert.equal(parsed.findings.length, 1)
})

test('bad entries are skipped with a warning naming each, good ones are kept', () => {
  const parsed = parseFindings(
    JSON.stringify({
      findings: [
        'just text',
        { path: 'a.ts', line: 3 },
        { path: 'a.ts', line: 3, body: '   ' },
        { path: 'a.ts', line: 0, body: 'zero' },
        { line: 4, body: 'line without file' },
        { path: 'a.ts', startLine: 9, line: 5, body: 'backwards range' },
        { path: 7, body: 'path not text' },
        { path: 'a.ts', line: 2, body: 'kept' }
      ]
    })
  )
  assert.deepEqual(parsed.findings, [{ filePath: 'a.ts', line: 2, body: 'kept', blocking: false }])
  assert.deepEqual(parsed.warnings, [
    'Agent Finding 1 skipped: not an object.',
    'Agent Finding 2 skipped: no body.',
    'Agent Finding 3 skipped: no body.',
    'Agent Finding 4 skipped: line must be a whole number from 1.',
    'Agent Finding 5 skipped: a line needs a path.',
    'Agent Finding 6 skipped: startLine is after line.',
    'Agent Finding 7 skipped: path must be text.'
  ])
})

test('a file that is not JSON, or has no findings list, gives one warning and no findings', () => {
  const broken = parseFindings('{ "findings": [')
  assert.deepEqual(broken.findings, [])
  assert.equal(broken.warnings.length, 1)
  assert.match(broken.warnings[0]!, /^findings\.json isn't valid JSON/)

  const shapeless = parseFindings('{ "issues": [] }')
  assert.deepEqual(shapeless.findings, [])
  assert.deepEqual(shapeless.warnings, ['findings.json has no "findings" list.'])
})
