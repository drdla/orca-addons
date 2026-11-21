// The "← Back" button at the top of a drill-in view (Settings, Review Draft): it returns to the
// Review Requests tabs. Two non-breaking spaces after the arrow: one looks cramped in Orca.
import { Button } from './button'

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Button size="xs" variant="ghost" tooltip="Back to Review Requests" onPress={onPress}>
      {'←\u00a0\u00a0Back'}
    </Button>
  )
}
