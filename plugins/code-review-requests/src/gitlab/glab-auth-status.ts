// Which hosts glab is logged in to, read from `glab auth status` (#8). The setup checklist offers
// them as "Use <host>" when glab is not logged in to the configured host. glab writes one block
// per host, with a "✓ Logged in to <host> as <user>" line for a working login.

/** The hosts with a working glab login, in glab's order, without duplicates. */
export function loggedInHosts(output: string): string[] {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '')
  const hosts: string[] = []
  for (const match of plain.matchAll(/✓\s*Logged in to (\S+) as /g)) {
    if (!hosts.includes(match[1]!)) hosts.push(match[1]!)
  }
  return hosts
}
