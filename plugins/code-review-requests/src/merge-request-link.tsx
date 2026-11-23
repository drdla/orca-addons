// The merge request's id as a small outlined button at the start of a card's title row: "2416",
// "Open <URL>" as its tooltip, opening the page in the browser. No icon: Orca's icons have no
// GitLab logo; a Badge can't be pressed or carry a tooltip, so it's a Button.
// MergeRequestTitle is that button with the title and "by <author>" beside it: the core of a
// Review Request card, which Finish Review repeats.
import { Box, Row, Text } from 'orca'
import { Button } from './button'

export function MergeRequestLink(props: { url: string; iid: number; onOpen: (url: string) => void }) {
  return (
    <Button size="xs" variant="outline" tooltip={`Open ${props.url}`} onPress={() => props.onOpen(props.url)}>
      {String(props.iid)}
    </Button>
  )
}

export function MergeRequestTitle(props: {
  url: string
  iid: number
  title: string
  author: string
  onOpen: (url: string) => void
}) {
  return (
    <Row gap="sm" align="start">
      <MergeRequestLink url={props.url} iid={props.iid} onOpen={props.onOpen} />
      {/* Nudged down 2px so the title's first line sits level with the button's text; the
          author sits under the title, at its indent. */}
      <Box direction="column">
        <Box height={2} />
        <Text weight="semibold">{props.title}</Text>
        <Text muted size="xs">{`by ${props.author}`}</Text>
      </Box>
    </Row>
  )
}
