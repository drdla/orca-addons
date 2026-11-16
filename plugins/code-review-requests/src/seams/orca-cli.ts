// The OrcaCli seam: the worker reaches what the host API lacks (MR links on worktrees, diff
// comments, create with an MR link, remove) through the `orca` CLI. The real adapter spawns
// `/Applications/Orca.app/Contents/Resources/bin/orca … --json` (#27); tests use
// src/fakes/fake-orca-cli.ts.

/** An item linked to a worktree; a Review Workspace has a GitLab MR link with the MR web URL. */
export type LinkedItem = {
  provider: string
  type: string
  url: string
  number?: number
  title?: string
}

/** A row of `orca worktree list --json` (only the fields the plugin reads). */
export type Worktree = {
  /** `<repoId>::<abs path>`; select it with `id:<id>`. */
  id: string
  repoId: string
  path: string
  branch: string | null
  displayName: string
  linkedItems: LinkedItem[]
}

/** An Orca diff-view note, as `orca worktree show --json` returns it. */
export type DiffComment = {
  id: string
  worktreeId: string
  filePath: string
  source?: 'diff' | 'markdown'
  selectedText?: string
  startLine?: number
  lineNumber: number
  body: string
  createdAt: number
  updatedAt?: number
  sentAt?: number
  scope?: 'unstaged' | 'staged' | 'branch'
  oldPath?: string
  diffIdentity?: string
  side: 'modified'
}

/** `orca worktree show --json` → `result.worktree`. */
export type WorktreeDetail = Worktree & { baseRef?: string; diffComments?: DiffComment[] }

/** `orca worktree create` flags. `references` and `--no-parent` are what a Review Workspace uses. */
export type CreateWorktreeInput = {
  name: string
  project?: string
  repo?: string
  baseBranch?: string
  branch?: string
  /** MR web URLs, passed as repeated `--reference`. */
  references?: string[]
  agent?: string
  prompt?: string
  activate?: boolean
  comment?: string
}

export type RemoveWorktreeOptions = { force?: boolean; deleteBranch?: boolean }

export interface OrcaCli {
  listWorktrees(): Promise<Worktree[]>
  /** `selector` is an Orca worktree selector such as `id:<id>` or `path:<abs path>`. */
  showWorktree(selector: string): Promise<WorktreeDetail>
  createWorktree(input: CreateWorktreeInput): Promise<Worktree>
  removeWorktree(selector: string, options?: RemoveWorktreeOptions): Promise<void>
}

/** A failed CLI call: `code` is the envelope's `error.code` (or `unavailable` if it can't run). */
export class OrcaCliError extends Error {
  readonly code: string
  readonly data: unknown

  constructor(code: string, message: string, data?: unknown) {
    super(message)
    this.name = 'OrcaCliError'
    this.code = code
    this.data = data
  }
}
