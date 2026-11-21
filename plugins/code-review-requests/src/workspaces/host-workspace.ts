// The orca CLI and the host API name workspaces differently (`<repoId>::<path>` vs the id
// `workspace.list` gives), so host calls map a worktree to its host id by path.
import type { OrcaWorkerApi } from 'orca/worker'

/** The host's id (`workspace.list`) for a workspace the orca CLI lists, matched by path. */
export async function hostWorkspaceIdOf(
  host: OrcaWorkerApi['host'],
  workspace: { name: string; path: string }
): Promise<string> {
  const { workspaces } = await host.call('workspace.list')
  const row = workspaces.find((w) => w.path === workspace.path)
  if (!row) throw new Error(`Orca doesn't list the workspace ${workspace.name}.`)
  return row.id
}
