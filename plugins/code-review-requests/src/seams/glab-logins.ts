// The GlabLogins seam (#8): which hosts glab is logged in to, from `glab auth status`. The setup
// checklist offers them as "Use <host>" when glab is logged out of the configured host. Asked only
// after a poll found glab logged out, never in activate. The fake is src/fakes/fake-glab.ts.

export interface GlabLogins {
  /** The hosts with a working glab login; empty when glab is missing or can't tell. */
  loggedInHosts(glabPath: string | null): Promise<string[]>
}
