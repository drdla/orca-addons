// PROTOTYPE: panel <-> worker contract.
export {}

export type PanelState = 'loaded' | 'empty' | 'loading' | 'refreshing' | 'offline' | 'setup'
export type StatusVariant = 'icon-count' | 'label' | 'quiet'

declare module 'orca' {
  interface PluginRequests {
    /** Redraw the status-bar item for a given look and panel state. */
    'proto.statusBar': {
      input: { variant: StatusVariant; state: PanelState; count: number; newCount: number }
      output: { text: string; tone: string; visible: boolean }
    }
    /** Set the prototype switches from outside (orca plugin dev request), for screenshots. */
    'proto.set': {
      input: { variant?: string; state?: PanelState; status?: StatusVariant }
      output: { ok: true }
    }
  }
}
