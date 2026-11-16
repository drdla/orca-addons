// Connection identity (#8, #25): what the worker caches its transport and the Connection section
// its check under. It changes with the host, the token and the glab path, and never holds the token.
import { assert, test } from 'orca/testing'
import { connectionKeyOf } from './connection-key'

const glab = { host: 'gitlab.example.com', token: null, glabPath: null }

test('a key never contains the token itself', () => {
  const key = connectionKeyOf({ ...glab, token: 'glpat-SECRET-123' })
  assert.ok(!key.includes('glpat-SECRET-123'))
  assert.ok(!key.includes('SECRET'))
})

test('the key changes with the host, the token and the glab path, and only with them', () => {
  const keys = [
    connectionKeyOf(glab),
    connectionKeyOf({ ...glab, host: 'gitlab.com' }),
    connectionKeyOf({ ...glab, token: 'glpat-a' }),
    connectionKeyOf({ ...glab, token: 'glpat-b' }),
    connectionKeyOf({ ...glab, glabPath: '/tools/glab' })
  ]
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(connectionKeyOf({ ...glab, token: 'glpat-a' }), connectionKeyOf({ ...glab, token: 'glpat-a' }))
  assert.equal(connectionKeyOf(null), connectionKeyOf(null))
  assert.notEqual(connectionKeyOf(null), connectionKeyOf(glab))
})
