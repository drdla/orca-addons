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
  /** A Linear issue's identifier, for example `OEO-9` (Linear links only). */
  identifier?: string
}

/** A row of `orca worktree list --json` (only the fields the plugin reads). */
export type Worktree = {
  /** `<repoId>::<abs path>`; select it with `id:<id>`. */
  id: string
  repoId: string
  /** `git:<host>/<project path>` for a Git remote, for example `git:gitlab.com/acme/api`. */
  projectId: string
  path: string
  isMainWorktree: boolean
  /** The full ref, for example `refs/heads/feature/x`. */
  branch: string | null
  displayName: string
  /** The legacy GitLab MR link: the MR iid, or null. */
  linkedGitLabMR: number | null
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

/**
 * `orca worktree create` flags. A Review Workspace uses `repo`, `baseBranch` (the fetched target
 * branch, which Orca keeps as the worktree's `baseRef`; #54), `gitlabMr` (the MR web URL, as
 * Orca's own "Start workspace from MR" links it), `noParent` and `setup: 'skip'`. `references`
 * and `gitlabMr` can't be combined.
 */
export type CreateWorktreeInput = {
  name: string
  project?: string
  repo?: string
  baseBranch?: string
  branch?: string
  /** MR web URLs, passed as repeated `--reference`. */
  references?: string[]
  /** `--gitlab-mr <url>`: links the MR (it must belong to the repo's project). */
  gitlabMr?: string
  /** `--no-parent`: a plugin worker has no lineage to record. */
  noParent?: boolean
  /** `--setup run|skip|inherit`: whether Orca runs the repo's setup hooks (default: its policy). */
  setup?: 'run' | 'skip' | 'inherit'
  agent?: string
  prompt?: string
  activate?: boolean
  comment?: string
}

export type RemoveWorktreeOptions = { force?: boolean; deleteBranch?: boolean }

/** An agent in a worktree, as `orca worktree ps --json` lists it (only the fields read). */
export type WorktreeAgent = {
  /** `working`, `blocked` (waiting for permission), `waiting` (for input), `done`… */
  state: string
  agentType?: string
}

/** A row of `orca worktree ps --json`: a worktree's agents (only the fields the plugin reads). */
export type WorktreeAgents = { worktreeId: string; agents: WorktreeAgent[] }

export interface OrcaCli {
  listWorktrees(): Promise<Worktree[]>
  /** `orca worktree ps`: the agents in each worktree, for the Agent Review line (#10). */
  listAgents(): Promise<WorktreeAgents[]>
  /** `selector` is an Orca worktree selector such as `id:<id>` or `path:<abs path>`. */
  showWorktree(selector: string): Promise<WorktreeDetail>
  createWorktree(input: CreateWorktreeInput): Promise<Worktree>
  removeWorktree(selector: string, options?: RemoveWorktreeOptions): Promise<void>
  /** `orca worktree set --display-name`: the name Orca shows; the branch and folder stay. */
  setDisplayName(selector: string, name: string): Promise<void>
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
