// The Manual drill-in view: the ⓘ between Refresh and Settings opens it in place of the tabs, ← Back
// returns. One page in the glossary's terms, about the workflow rather than every button. Install,
// development and release are the README's.
import { atom, Heading, read, Row, Separator, set, Stack, Text } from 'orca'
import { BackButton } from './back-button'

/** Kept across reloads, like the Settings view. */
const manualOpen = atom('rr.manualOpen', false, { persist: 'plugin' })

export function isManualOpen(): boolean {
  return read(manualOpen)
}

export function openManual(): void {
  set(manualOpen, true)
}

function closeManual(): void {
  set(manualOpen, false)
}

/** The Manual's sections, in reading order: a heading and its paragraphs. */
export const MANUAL_SECTIONS: readonly { title: string; paragraphs: readonly string[] }[] = [
  {
    title: 'Review Requests',
    paragraphs: [
      'A Review Request is an open, non-draft GitLab merge request on which you are a Reviewer and have not approved yet. The plugin reads them from your GitLab instance every 5 minutes by default; Refresh reads them now.',
      'The number in the status bar and in the pill next to the heading counts them. A Review Request is overdue once it has waited longer than "Overdue after" (24 working hours by default, Monday to Friday only) since you were added as Reviewer: it gets a Late badge, and the overdue count turns the pill red.'
    ]
  },
  {
    title: 'The tabs',
    paragraphs: [
      'Todo holds Review Requests you have not started. Reviewing holds those with a Review Workspace. Done holds Ended Review Requests (approved, merged, closed, or you were removed as Reviewer) whose Review Workspace still exists.',
      'The search above the tabs narrows all three to the merge requests whose title or URL contains what you type. Paste a merge request link to find its card: when only one other tab has it, that tab opens.'
    ]
  },
  {
    title: 'Starting a review',
    paragraphs: [
      'Start Review creates a Review Workspace: an Orca workspace on the merge request\'s branch. With a Review Prompt set, it also starts an Agent Review in it, an agent run with that prompt; the agent button on a Reviewing card starts another.',
      'A Reviewing card opens the workspace, its changed files and the Review Cover Page, a read-only summary of the merge request. When the merge request gets new commits, the card says "Merge request updated", and Update Workspace moves the workspace to them.'
    ]
  },
  {
    title: 'The Review Draft',
    paragraphs: [
      'Review Draft collects what you will post: the notes you add in Orca\'s diff view and the Agent Findings of Agent Reviews. Check what you want to post; Agent Findings can be edited first. Comments on lines that changed since are marked "May be outdated", and findings for an older commit "Stale".',
      'Post sends the checked Review Comments, an optional summary and your verdict (comment, request changes or approve) to GitLab as one review.'
    ]
  },
  {
    title: 'Done and cleaning up',
    paragraphs: [
      'A Done card says why the review ended. Review Draft posts what is left; Remove Workspace deletes the Review Workspace and its branch, after saying what would be lost. Clean workspaces are removed by themselves after "Remove ended review workspaces after" days.'
    ]
  },
  {
    title: 'Filters and settings',
    paragraphs: [
      'The gear opens Settings: the GitLab connection, how often to refresh, when a Review Request is overdue, the Review Prompt and the review agent.',
      'Filters hide Review Requests by group or project path, or by author. A hidden Review Request is not in the tabs or in search; the line under the tabs says how many are hidden. A Review Request with a Review Workspace is never hidden.'
    ]
  }
]

export function ManualScreen() {
  return (
    <Stack gap="md">
      <Row gap="sm">
        <BackButton onPress={closeManual} />
        <Heading level={2}>Manual</Heading>
      </Row>
      {MANUAL_SECTIONS.map((section, index) => (
        <Stack key={section.title} gap="sm">
          {index > 0 && <Separator />}
          <Heading level={3}>{section.title}</Heading>
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph}>{paragraph}</Text>
          ))}
        </Stack>
      ))}
    </Stack>
  )
}
