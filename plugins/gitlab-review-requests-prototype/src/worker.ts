// PROTOTYPE worker: only drives the status-bar item from whatever the panel's switcher picks.
import type { OrcaWorkerApi } from 'orca/worker'
import { spawn } from 'node:child_process'
import type { PanelState, StatusVariant } from './protocol'

type Look = {
  text: string
  icon?: string
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  tooltip: string
  visible: boolean
}

function look(variant: StatusVariant, state: PanelState, count: number, newCount: number): Look {
  if (state === 'setup')
    return { text: 'GitLab: set up', icon: 'plug', tone: 'warning', tooltip: 'Connect GitLab to see Review Requests', visible: true }
  if (state === 'offline')
    return {
      text: variant === 'quiet' ? `${count}` : `GitLab: offline`,
      icon: 'warning',
      tone: 'warning',
      tooltip: `Can't reach gitlab.com. Showing ${count} Review Requests from 2 minutes ago.`,
      visible: true
    }
  if (state === 'loading')
    return { text: variant === 'label' ? 'Reviews …' : '…', icon: 'refresh', tone: 'neutral', tooltip: 'Loading Review Requests', visible: true }

  const tooltip =
    `${count} Review Request${count === 1 ? '' : 's'}` + (newCount ? `, ${newCount} new` : '') + '. Click to open.'

  switch (variant) {
    case 'icon-count':
      // Always shown; accent while something is new.
      return { text: `${count}`, icon: 'branch', tone: newCount ? 'accent' : 'neutral', tooltip, visible: true }
    case 'label':
      // Spelled out, with a "new" marker.
      return {
        text: count === 0 ? 'No reviews' : `${count} review${count === 1 ? '' : 's'}` + (newCount ? ` · ${newCount} new` : ''),
        icon: 'check',
        tone: newCount ? 'accent' : 'neutral',
        tooltip,
        visible: true
      }
    case 'quiet':
      // Hidden at zero; warning tone once anything waits.
      return { text: `${count}`, icon: 'bell', tone: count ? 'warning' : 'neutral', tooltip, visible: count > 0 }
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('proto.statusBar', async ({ variant, state, count, newCount }) => {
    const l = look(variant, state, count, newCount)
    await orca.host.call('statusBar.update', { id: 'review-requests', ...l } as never)
    return { text: l.text, tone: l.tone, visible: l.visible }
  })

  orca.panels.handle('proto.set', async ({ variant, state, status }) => {
    if (variant) await orca.storage.set('proto.variant', variant)
    if (state) await orca.storage.set('proto.state', state)
    if (status) await orca.storage.set('proto.status', status)
    const st = ((await orca.storage.get('proto.state')) ?? 'loaded') as PanelState
    const sv = ((await orca.storage.get('proto.status')) ?? 'icon-count') as StatusVariant
    const empty = st === 'empty'
    await orca.host.call('statusBar.update', { id: 'review-requests', ...look(sv, st, empty ? 0 : 5, empty ? 0 : 2) } as never)
    return { ok: true as const }
  })

  // Pressing the status-bar item opens the panel. The host API can't open a panel, so use the CLI.
  orca.commands.register('gitlab-review-requests-prototype.open', () => {
    const child = spawn(
      '/Applications/Orca.app/Contents/Resources/bin/orca',
      ['plugin', 'open', 'local.gitlab-review-requests-prototype', '--panel', 'review-requests'],
      { stdio: 'ignore', detached: true }
    )
    child.unref()
    return 'Opening Review Requests'
  })
}
