// glab's logins for tests: the hosts `glab auth status` reports, and how often it was asked.
import type { GlabLogins } from '../seams/glab-logins'

export class FakeGlab implements GlabLogins {
  loggedIn: string[] = []
  statusChecks = 0

  async loggedInHosts(): Promise<string[]> {
    this.statusChecks++
    return [...this.loggedIn]
  }
}
