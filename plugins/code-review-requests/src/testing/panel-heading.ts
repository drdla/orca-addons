// Shared test helper for the panel heading's count pill (#53). Not a test file itself (no
// `.test.`), so the runner doesn't execute it; import it from tests.
import { assert, type mount } from 'orca/testing'

/** The heading's counts as [count, look], and only those: not the separator, nothing on a card. */
export function headingCounts(view: Awaited<ReturnType<typeof mount>>): [string, 'dim' | 'strong'][] {
  const counts = headingPill(view)
  return view
    .findAll({ type: 'Text' })
    .filter((text) => text.path.startsWith(`${counts.path}/`) && /^\d+$/.test(text.text))
    .map((text): [string, 'dim' | 'strong'] => [text.text, text.props.muted === true ? 'dim' : 'strong'])
}

/** The pill's background and border: muted and none, or red while any Review Request is overdue. */
export function headingLook(view: Awaited<ReturnType<typeof mount>>): { background: unknown; border: unknown } {
  const { background, border } = headingPill(view).props
  return { background, border }
}

function headingPill(view: Awaited<ReturnType<typeof mount>>) {
  const pill = view.find({ testId: 'heading-counts' })
  assert.ok(pill, 'the heading has its counts')
  return pill
}
