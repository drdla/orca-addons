// The merge request's id as a small outlined button at the start of a card's title row: "2416",
// "Open <URL>" as its tooltip, opening the page in the browser. No icon: Orca's icons have no
// GitLab logo; a Badge can't be pressed or carry a tooltip, so it's a Button.
import { Button } from './button'

export function MergeRequestLink(props: { url: string; iid: number; onOpen: (url: string) => void }) {
  return (
    <Button size="xs" variant="outline" tooltip={`Open ${props.url}`} onPress={() => props.onOpen(props.url)}>
      {String(props.iid)}
    </Button>
  )
}
