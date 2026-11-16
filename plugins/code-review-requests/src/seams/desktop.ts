// The Desktop seam: the two things the host API can't do for the panel (#10, research #3), done
// from the worker instead. Fakes in src/fakes/fake-desktop.ts; the real one in desktop-process.ts.

export interface Desktop {
  /** Puts `text` on the system clipboard (no host API has a clipboard). */
  copyText(text: string): Promise<void>
  /** Opens this plugin's panel `panelId` in Orca (no host API opens a panel; the CLI does). */
  openPanel(panelId: string): Promise<void>
}
