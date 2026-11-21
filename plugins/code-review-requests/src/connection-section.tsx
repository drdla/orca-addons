// The Connection part of the panel's Settings view and the token entry (#8, #25): the active
// source, the signed-in user, what the scopes allow, Test connection, and a token field to save,
// replace or remove a token. TokenEntry is also the setup checklist's
// second path. The worker validates and stores tokens (rr.saveToken); the panel never keeps one
// beyond the field it is typed into, and clears that once it is stored.
import { atom, Code, Collapsible, Input, Link, plugin, read, Row, set, Stack, Text } from 'orca'
import { Button } from './button'
import type { ConnectionView } from './protocol'
import { messageOf } from './errors'

/** The worker's last answer about the connection; null until it answers. */
const connection = atom<ConnectionView | null>(null)
/** Can the connection post reviews (#30)? null until the worker answers, or when unknown. */
export function canPostReviews(): boolean | null {
  return read(connection)?.canPost ?? null
}

/** What is typed into the token field. */
const tokenDraft = atom('')
/** Why the last save or remove didn't work. */
const tokenError = atom<string | null>(null)
/** True while a save, remove or test runs. */
const busy = atom(false)

/** Asks the worker about the connection; `test` re-checks the user and scopes. */
export function loadConnection(test = false): Promise<void> {
  return plugin
    .request('rr.connection', { test })
    .then((answer) => set(connection, answer))
    .catch(() => {
      // Nothing to show without an answer; the snapshot's own failure states cover the rest.
    })
}

function run(work: () => Promise<void>): void {
  set(busy, true)
  work()
    .catch((error: unknown) => set(tokenError, messageOf(error)))
    .finally(() => set(busy, false))
}

function saveToken(draft: string): void {
  const token = draft.trim()
  if (token === '') return
  run(async () => {
    const answer = await plugin.request('rr.saveToken', { token }, { timeoutMs: 120_000 })
    set(connection, answer.connection)
    set(tokenError, answer.error)
    if (answer.error === null) set(tokenDraft, '')
  })
}

function removeToken(): void {
  run(async () => {
    set(connection, await plugin.request('rr.removeToken', undefined, { timeoutMs: 120_000 }))
    set(tokenError, null)
  })
}

function testConnection(): void {
  run(() => loadConnection(true))
}

/** `<host>/-/user_settings/personal_access_tokens` with the scopes and a name filled in. */
export function newTokenUrl(host: string): string {
  return `https://${host}/-/user_settings/personal_access_tokens?scopes=read_api,api&name=Orca+Review+Requests`
}

function sourceLine(view: ConnectionView): string {
  const host = view.host ?? 'GitLab'
  return view.source === 'token' ? `Token for ${host}` : `glab, logged in to ${host}`
}

function scopeLine(view: ConnectionView): string | null {
  if (view.canList === null) return null
  const mark = (can: boolean | null) => (can === false ? '✗' : '✓')
  return `Can list ${mark(view.canList)} · Can post review ${mark(view.canPost)}`
}

/** The token field with Save, plus Remove when a token is in use. `host` names where to create one. */
export function TokenEntry(props: { host: string | null }) {
  const view = read(connection)
  const usingToken = view?.source === 'token'
  const unavailable = view?.tokenStorage === 'unavailable'
  const working = read(busy)
  const error = read(tokenError)
  const host = props.host ?? view?.host ?? null
  const draft = read(tokenDraft)
  return (
    <Stack gap="xs">
      <Row gap="sm" align="end">
        <Input
          label={usingToken ? 'Replace token' : 'Use a token instead'}
          type="password"
          placeholder="glpat-…"
          value={draft}
          disabled={unavailable || working}
          onChange={(value) => set(tokenDraft, value)}
          onSubmit={(value) => {
            set(tokenDraft, value)
            saveToken(value)
          }}
        />
        <Button disabled={unavailable || working || draft.trim() === ''} onPress={() => saveToken(draft)}>
          Save token
        </Button>
        {usingToken && (
          <Button variant="ghost" tone="danger" disabled={working} onPress={removeToken}>
            Remove token
          </Button>
        )}
      </Row>
      {unavailable ? (
        <Text muted size="xs">
          This system has no secure key store, so tokens can't be saved. Only glab works here.
        </Text>
      ) : (
        host !== null && (
          <Text muted size="xs">
            {'Needs read_api, plus api to post reviews. '}
            <Link href={newTokenUrl(host)}>Create a token on {host}</Link>
          </Text>
        )
      )}
      {error !== null && (
        <Text tone="danger" size="xs">
          {error}
        </Text>
      )}
    </Stack>
  )
}

/** Why the connection check failed, or null (also null until the worker answers). */
export function connectionProblem(): string | null {
  return read(connection)?.problem ?? null
}

/** "glab · signed in as me", or where it connects while nobody is signed in. */
export function connectionSummary(): string | null {
  const view = read(connection)
  if (view === null || !view.configured) return null
  return view.user === null ? sourceLine(view) : `${view.source === 'token' ? 'Token' : 'glab'} · signed in as ${view.user}`
}

/**
 * The Settings view's Connection part: the source and signed-in user, what the scopes allow, the
 * problem if any, the token field and Test connection. `withActions: false` leaves out the problem,
 * the token field and Test connection, for when the setup checklist below offers them.
 */
export function ConnectionDetails(props: { withActions: boolean }) {
  const view = read(connection)
  if (view === null) return null
  if (!view.configured) {
    return (
      <Text muted size="sm">
        Set the GitLab instance URL below to connect.
      </Text>
    )
  }
  const scopes = scopeLine(view)
  return (
    <Stack gap="sm">
      <Text>{connectionSummary()}</Text>
      {view.user !== null && (
        <Text muted size="sm">
          {sourceLine(view)}
        </Text>
      )}
      {scopes !== null && <Text size="sm">{scopes}</Text>}
      {view.canPost === false && (
        <Text muted size="xs">
          Posting reviews needs a token with the api scope.
        </Text>
      )}
      {props.withActions && view.problem !== null && (
        <Stack gap="xs">
          <Text tone="danger" size="sm">
            {view.problem}
          </Text>
          <Collapsible title="Details">
            <Code block>{view.problem}</Code>
          </Collapsible>
        </Stack>
      )}
      {props.withActions && <TokenEntry host={view.host} />}
      {props.withActions && (
        <Row gap="sm">
          <Button icon="refresh" variant="ghost" size="sm" disabled={read(busy)} onPress={testConnection}>
            Test connection
          </Button>
        </Row>
      )}
    </Stack>
  )
}
