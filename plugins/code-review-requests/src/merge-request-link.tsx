// The merge request's id as a small outlined button at the start of a card's title row: "2416",
// the full URL as its tooltip, opening the page in the browser. Orca's icons have no GitLab logo,
// so it uses `link`; a Badge can't be pressed or carry a tooltip, so it's a Button.
import { Button } from './button'

export function MergeRequestLink(props: { url: string; iid: number; onOpen: (url: string) => void }) {
  return (
    <Button size="xs" variant="outline" icon="link" tooltip={props.url} onPress={() => props.onOpen(props.url)}>
      {String(props.iid)}
    </Button>
  )
}
