// The "← Back" button at the top of a drill-in view (Settings, Review Draft): it returns to the
// Review Requests tabs.
import { Button } from './button'

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Button size="xs" variant="ghost" tooltip="Back to Review Requests" onPress={onPress}>
      ← Back
    </Button>
  )
}
