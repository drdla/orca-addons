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

/**
 * The Manual's sections, in reading order: an optional heading and its paragraphs. Written to
 * ASD-STE100 (Simplified Technical English): short sentences, active voice, one idea per sentence.
 */
export const MANUAL_SECTIONS: readonly { title?: string; paragraphs: readonly string[] }[] = [
  {
    paragraphs: [
      'This plugin helps you manage the code reviews requested from you. It checks out a merge request so you can review it locally with Orca\'s tools. An agent reviews it first, so you can focus on the non-trivial parts.'
    ]
  },
  {
    title: 'Start a review',
    paragraphs: [
      '"Start Review" creates an Orca workspace on the merge request branch and starts the review agent.',
      'The card buttons open the workspace, the changed files and the merge request summary.',
      'When the merge request gets new commits, "Pull Changes" brings them into the workspace; until then "Finish Review" is disabled.',
      'To drop a review you started, the bin at the end of the card deletes its workspace and Review Draft at once, uncommitted changes and open terminals included; the review goes back to Todo.'
    ]
  },
  {
    title: 'Write and post the review',
    paragraphs: [
      'Comments you add in Orca\'s diff view and the agent\'s findings collect under "Finish Review".',
      'Select, edit or drop them, add a summary if you like, and press Post Review. They go to GitLab as one review. The outcome is Request changes when comments are selected and Approve when none are; pick another one if you like. Approve and Request changes both finish your part: the merge request moves to Done, and the panel shows it there. Comment keeps it in Reviewing. Whatever you left unchecked is cleared from the Review Draft once the review is posted.'
    ]
  },
  {
    title: 'Clean up after review',
    paragraphs: [
      'Ended reviews move to Done. "Delete Workspace" deletes the workspace and its branch at once, without asking.',
      'When the author re-requests your review, it goes back to Todo marked "Follow-up", with what you did last time. "Start Review" reuses its workspace if it still has one, moved to the new commits.',
      'Clean workspaces are removed automatically after 2 days.'
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
        <Stack key={section.title ?? index} gap="sm">
          {section.title !== undefined && <Separator />}
          {section.title !== undefined && <Heading level={3}>{section.title}</Heading>}
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph}>{paragraph}</Text>
          ))}
        </Stack>
      ))}
    </Stack>
  )
}
