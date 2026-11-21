// Relative times in the panel never show seconds: "just now", then "1m ago", "2h ago", "3d ago".
import { assert, test } from 'orca/testing'
import { formatAge, formatAgo, nextChangeAt } from './minute-time'

const NOW = Date.UTC(2026, 10, 16, 9, 0, 0)
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

test('under a minute is "just now", then whole minutes, hours and days', () => {
  assert.equal(formatAgo(NOW, NOW, 'en-US'), 'just now')
  assert.equal(formatAgo(NOW - 59 * SECOND, NOW, 'en-US'), 'just now')
  assert.equal(formatAgo(NOW - 60 * SECOND, NOW, 'en-US'), '1m ago')
  assert.equal(formatAgo(NOW - 2 * MINUTE - 59 * SECOND, NOW, 'en-US'), '2m ago')
  assert.equal(formatAgo(NOW - 59 * MINUTE, NOW, 'en-US'), '59m ago')
  assert.equal(formatAgo(NOW - 2 * HOUR, NOW, 'en-US'), '2h ago')
  assert.equal(formatAgo(NOW - 3 * 24 * HOUR, NOW, 'en-US'), '3d ago')
})

test('a time ahead says "in 1m" or more, and "shortly" under a minute', () => {
  assert.equal(formatAgo(NOW + 30 * SECOND, NOW, 'en-US'), 'shortly')
  assert.equal(formatAgo(NOW + 90 * SECOND, NOW, 'en-US'), 'in 1m')
})

test('the text next changes when the shown minute (or hour, or day) does, not every second', () => {
  assert.equal(nextChangeAt(NOW - 10 * SECOND, NOW), NOW + 50 * SECOND)
  assert.equal(nextChangeAt(NOW - 2 * MINUTE - 5 * SECOND, NOW), NOW + 55 * SECOND)
  assert.equal(nextChangeAt(NOW - 2 * HOUR - 10 * MINUTE, NOW), NOW + 50 * MINUTE)
  assert.equal(nextChangeAt(NOW + 90 * SECOND, NOW), NOW + 30 * SECOND)
  assert.equal(nextChangeAt(NOW + 30 * SECOND, NOW), NOW + 30 * SECOND)
})

test('an age is short, "5m" rather than "5m ago", and under a minute is "1m"', () => {
  assert.equal(formatAge(NOW - 59 * SECOND, NOW), '1m')
  assert.equal(formatAge(NOW - 5 * MINUTE - 20 * SECOND, NOW), '5m')
  assert.equal(formatAge(NOW - 2 * HOUR, NOW), '2h')
  assert.equal(formatAge(NOW - 88 * 24 * HOUR, NOW), '88d')
  assert.equal(formatAge(NOW + MINUTE, NOW), '1m')
})
