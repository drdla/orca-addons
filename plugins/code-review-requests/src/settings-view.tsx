// The panel's Settings view: opened by the gear next to Refresh, closed by Back (the selected tab
// is its own atom, so the tabs come back as they were). Orca's plugin API can't open Orca's own
// Settings page, so the panel shows the same settings itself: the connection first (with the
// setup checklist while GitLab needs setting up), then every setting the manifest declares
// (SETTING_FIELDS), saved through settings:own so Orca's Settings page shows the same values, and
// kept current when the person changes them there.
import {
  atom,
  Button,
  Field,
  Heading,
  Input,
  read,
  Row,
  Separator,
  set,
  settings,
  Skeleton,
  Stack,
  Text,
  Textarea,
  update,
  type PanelContext
} from 'orca'
import { ConnectionDetails } from './connection-section'
import { messageOf } from './errors'
import type { ReviewRequestsSnapshot } from './protocol'
import { parseSettingInput, readSettings, SETTING_FIELDS, type SettingField, type Settings } from './settings'
import { SetupChecklist, type NeedsYouView } from './setup-checklist'

type Key = keyof Settings

/** True while the Settings view replaces the tabs; kept across reloads, like the open Review Draft. */
const settingsOpen = atom('rr.settingsOpen', false, { persist: 'plugin' })
/** The stored settings (defaults filled in); null until read. */
const stored = atom<Settings | null>(null)
/** What is typed into a field and not saved yet, by key. */
const drafts = atom<Partial<Record<Key, string>>>({})
/** Why a field's value can't be saved, by key. */
const fieldErrors = atom<Partial<Record<Key, string>>>({})

/** The filter settings: the snapshot's ignored entries are shown below them (#26). */
const FILTER_KEYS: readonly Key[] = ['pathAllowlist', 'pathBlocklist', 'authorBlocklist']

export function isSettingsOpen(): boolean {
  return read(settingsOpen)
}

export function openSettings(): void {
  set(settingsOpen, true)
}

function closeSettings(): void {
  set(settingsOpen, false)
}

function loadSettings(): Promise<void> {
  return readSettings(settings)
    .then((values) => set(stored, values))
    .catch(() => {
      // Without settings:own there is nothing to show; the fields stay a skeleton.
    })
}

function withEntry<T>(record: Partial<Record<Key, T>>, key: Key, value: T | undefined): Partial<Record<Key, T>> {
  const next = { ...record }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

/** Reads the settings, and again whenever they change (here, in the worker, or in Orca's Settings). */
export function setupSettings(ctx: PanelContext): void {
  ctx.subscriptions.push(
    settings.onDidChange(({ key }) => {
      update(drafts, (all) => withEntry(all, key as Key, undefined))
      void loadSettings()
    })
  )
  void loadSettings()
}

function setDraft(key: Key, text: string): void {
  update(drafts, (all) => withEntry(all, key, text))
  update(fieldErrors, (all) => withEntry(all, key, undefined))
}

function revert(key: Key): void {
  update(drafts, (all) => withEntry(all, key, undefined))
  update(fieldErrors, (all) => withEntry(all, key, undefined))
}

function save(field: SettingField, text: string): void {
  const parsed = parseSettingInput(field, text)
  if ('error' in parsed) {
    update(fieldErrors, (all) => withEntry(all, field.key, parsed.error))
    return
  }
  settings
    .set(field.key, parsed.value)
    .then(() => {
      update(stored, (all) => (all === null ? all : { ...all, [field.key]: parsed.value }))
      update(drafts, (all) => withEntry(all, field.key, undefined))
      update(fieldErrors, (all) => withEntry(all, field.key, undefined))
    })
    .catch((error: unknown) =>
      update(fieldErrors, (all) => withEntry(all, field.key, `Couldn't save: ${messageOf(error)}`))
    )
}

export function SettingsScreen(props: {
  /** GitLab needs setting up: the setup checklist shows under the connection. */
  needsYou: NeedsYouView | null
  checking: boolean
  onCheckAgain: () => void
  onSnapshot: (snapshot: ReviewRequestsSnapshot) => void
  /** Filter entries the worker ignores (#26). */
  invalidFilterEntries: readonly string[]
}) {
  return (
    <Stack gap="md">
      <Row gap="sm">
        <Button size="xs" variant="ghost" tooltip="Back to Review Requests" onPress={closeSettings}>
          ← Back
        </Button>
        <Heading level={2}>Settings</Heading>
      </Row>
      <Stack gap="sm">
        <Heading level={3}>Connection</Heading>
        <ConnectionDetails withActions={props.needsYou === null} />
        {props.needsYou !== null && (
          <SetupChecklist
            problem={props.needsYou}
            checking={props.checking}
            onCheckAgain={props.onCheckAgain}
            onSnapshot={props.onSnapshot}
          />
        )}
      </Stack>
      <Separator />
      <SettingFields invalidFilterEntries={props.invalidFilterEntries} />
    </Stack>
  )
}

function SettingFields(props: { invalidFilterEntries: readonly string[] }) {
  const values = read(stored)
  if (values === null) return <Skeleton lines={6} label="Loading settings" />
  const lastFilter = FILTER_KEYS[FILTER_KEYS.length - 1]
  return (
    <Stack gap="md">
      {SETTING_FIELDS.map((field) => (
        <Stack key={field.key} gap="xs">
          <SettingInput field={field} value={String(values[field.key])} />
          {field.key === lastFilter && props.invalidFilterEntries.length > 0 && (
            <Text tone="warning" size="xs">
              {`Some filter entries are ignored. Not a valid path or username: ${props.invalidFilterEntries.join(', ')}.`}
            </Text>
          )}
        </Stack>
      ))}
    </Stack>
  )
}

/** One setting: its control, and Save while what is typed differs from what is stored. */
function SettingInput(props: { field: SettingField; value: string }) {
  const { field } = props
  const draft = read(drafts)[field.key]
  const error = read(fieldErrors)[field.key]
  const text = draft ?? props.value
  const dirty = draft !== undefined && draft !== props.value
  const onChange = (value: string) => setDraft(field.key, value)
  const onSubmit = (value: string) => save(field, value)
  return (
    <Field label={field.title} description={field.description} error={error}>
      {field.control === 'multiline' ? (
        <Textarea
          label={field.title}
          labelHidden
          value={text}
          rows={field.key === 'reviewPrompt' ? 8 : 3}
          invalid={error !== undefined}
          onChange={onChange}
          onSubmit={onSubmit}
        />
      ) : (
        <Input
          label={field.title}
          labelHidden
          value={text}
          placeholder={field.placeholder}
          invalid={error !== undefined}
          onChange={onChange}
          onSubmit={onSubmit}
        />
      )}
      {dirty && (
        <Row gap="sm">
          <Button size="xs" tooltip={`Save ${field.title}`} onPress={() => save(field, text)}>
            Save
          </Button>
          <Button size="xs" variant="ghost" onPress={() => revert(field.key)}>
            Revert
          </Button>
        </Row>
      )}
    </Field>
  )
}
