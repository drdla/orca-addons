// Overdue Review Requests (#10 amendment): waiting longer than the threshold, counting
// Monday to Friday only, in the machine's local time. Dates here are local on purpose.
import { assert, test } from 'orca/testing'
import { isOverdue, workingMsBetween } from './overdue'

const HOUR = 3_600_000
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()
// November 2026: Fri 13, Sat 14, Sun 15, Mon 16, Tue 17.

test('a weekday wait counts every hour', () => {
  assert.equal(workingMsBetween(local(16, 9), local(17, 9)), 24 * HOUR)
})

test('the weekend does not count', () => {
  assert.equal(workingMsBetween(local(13, 15), local(16, 15)), 24 * HOUR)
  assert.equal(workingMsBetween(local(14, 10), local(15, 20)), 0)
  assert.equal(workingMsBetween(local(14, 10), local(16, 2)), 2 * HOUR)
})

test('a request made Friday at 15:00 becomes overdue Monday at 15:00', () => {
  const requested = local(13, 15)
  assert.equal(isOverdue(requested, local(16, 14, 59), 24), false)
  assert.equal(isOverdue(requested, local(16, 15, 1), 24), true)
})

test('exactly at the threshold is not overdue yet, and a future time never is', () => {
  assert.equal(isOverdue(local(16, 9), local(17, 9), 24), false)
  assert.equal(isOverdue(local(17, 9), local(16, 9), 1), false)
})
