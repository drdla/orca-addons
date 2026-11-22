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
      'When the merge request gets new commits, "Update Workspace" pulls them in.'
    ]
  },
  {
    title: 'Write and post the review',
    paragraphs: [
      'Comments you add in Orca\'s diff view and the agent\'s findings collect under "Finish Review".',
      'Select, edit or drop them, pick the outcome (comment, approve or request changes), add a summary if you like, and press Post Review. They go to GitLab as one review. With nothing selected, Post Review only approves or requests changes.'
    ]
  },
  {
    title: 'Clean up after review',
    paragraphs: [
      'Ended reviews move to Done. "Remove Workspace" deletes the workspace and its branch.',
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
