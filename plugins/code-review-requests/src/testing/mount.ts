// `mount` for panel tests: orca/testing's, plus an afterEach that unmounts whatever a test left
// mounted. A test that fails before its own `view.unmount()` would otherwise leave the panel's
// timers (the Review Draft's re-import interval) running, and the test run would never end.
// Import `mount` from here, not from orca/testing. Not a test file itself (no `.test.`).
import { afterEach, mount as mountPanel } from 'orca/testing'

type TestPanel = Awaited<ReturnType<typeof mountPanel>>

const mounted = new Set<TestPanel>()

export async function mount(...args: Parameters<typeof mountPanel>): Promise<TestPanel> {
  const view = await mountPanel(...args)
  const unmount = view.unmount.bind(view)
  mounted.add(view)
  view.unmount = async () => {
    if (!mounted.delete(view)) return
    await unmount()
  }
  return view
}

afterEach(async () => {
  for (const view of [...mounted]) await view.unmount()
})
