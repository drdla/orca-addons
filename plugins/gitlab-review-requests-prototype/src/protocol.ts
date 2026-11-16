// PROTOTYPE: panel <-> worker contract.
export {}

export type PanelState = 'loaded' | 'empty' | 'loading' | 'refreshing' | 'offline' | 'setup'
export type StatusVariant = 'icon-count' | 'label' | 'quiet'
export type CatchUpStrategy = 'silent' | 'summary' | 'per-item' | 'hybrid' | 'split'
export type CatchUpScenario = 'live' | 'first-run' | 'short' | 'weekend' | 'vacation'

declare module 'orca' {
  interface PluginRequests {
    /** Redraw the status-bar item for a given look and panel state. */
    'proto.statusBar': {
      input: { variant: StatusVariant; state: PanelState; count: number; newCount: number; overdueCount: number }
      output: { text: string; tone: string; visible: boolean }
    }
    /** Set the prototype switches from outside (orca plugin dev request), for screenshots. */
    'proto.set': {
      input: { variant?: string; state?: PanelState; status?: StatusVariant; overdueHours?: string; tab?: string }
      output: { ok: true }
    }
    /** Fire the notifications a strategy would send for a scenario. Returns what was sent. */
    'proto.catchUp': {
      input: { strategy: CatchUpStrategy; scenario: CatchUpScenario; cap: number }
      output: { sent: { title: string; body: string }[]; note: string }
    }
  }
}
