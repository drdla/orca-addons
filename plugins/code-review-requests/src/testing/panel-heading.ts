// Shared test helper for the panel heading's count badges (#53). Not a test file itself (no
// `.test.`), so the runner doesn't execute it; import it from tests.
import { assert, type mount } from 'orca/testing'

/** The heading's count badges as [count, tone], and only those: never a badge on a card. */
export function headingCounts(view: Awaited<ReturnType<typeof mount>>): [string, unknown][] {
  const counts = view.find({ testId: 'heading-counts' })
  assert.ok(counts, 'the heading has its counts')
  return view
    .findAll({ type: 'Badge' })
    .filter((badge) => badge.path.startsWith(`${counts.path}/`))
    .map((badge): [string, unknown] => [badge.text, badge.props.tone])
}
