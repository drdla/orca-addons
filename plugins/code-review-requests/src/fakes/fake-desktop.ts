// A Desktop that only records: what was copied and which panels were opened.
import type { Desktop } from '../seams/desktop'

export class FakeDesktop implements Desktop {
  readonly clipboard: string[] = []
  readonly openedPanels: string[] = []

  async copyText(text: string): Promise<void> {
    this.clipboard.push(text)
  }

  async openPanel(panelId: string): Promise<void> {
    this.openedPanels.push(panelId)
  }
}
