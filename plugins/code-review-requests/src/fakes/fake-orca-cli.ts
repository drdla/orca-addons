// An in-memory OrcaCli for tests: worktrees live in a list, removal of a dirty worktree is
// refused without force, and failures can be injected. Extend it as slices need more (for example
// `worktree ps` agents for #28).
import {
  OrcaCliError,
  type CreateWorktreeInput,
  type DiffComment,
  type OrcaCli,
  type RemoveWorktreeOptions,
  type Worktree,
  type WorktreeAgents,
  type WorktreeDetail
} from '../seams/orca-cli'

export type WorktreeSeed = {
  name: string
  repoId?: string
  /** Defaults to `git:gitlab.example.com/acme/api`. */
  projectId?: string
  path?: string
  /** The short branch name; the fake reports it as `refs/heads/<branch>`, as Orca does. */
  branch?: string | null
  /** MR web URLs linked to the worktree. */
  references?: string[]
  /** A Linear issue linked to the worktree, listed after the references. */
  linearIssue?: { identifier: string; url: string }
  baseRef?: string
  /** Uncommitted changes: removal without force is refused. */
  dirty?: boolean
  /** The legacy GitLab MR link only (`--gitlab-mr`), without a linked item. */
  legacyGitLabMR?: number
  /** A repo's main checkout rather than a worktree of it (see addRepo). */
  isMainWorktree?: boolean
}

/** An Orca repo: its main worktree, which `orca worktree list` lists like any other. */
export type RepoSeed = { repoId: string; projectId: string; path: string; branch?: string }

type FakeWorktree = WorktreeDetail & { dirty: boolean }

export type FakeCliCall = { command: string; args?: unknown }

export class FakeOrcaCli implements OrcaCli {
  /** Every call made, in order. */
  readonly calls: FakeCliCall[] = []
  #worktrees: FakeWorktree[] = []
  #failures: OrcaCliError[] = []
  #agents = new Map<string, string[]>()

  // --- Arrange -----------------------------------------------------------------------------

  addWorktree(seed: WorktreeSeed): Worktree {
    const repoId = seed.repoId ?? 'repo-1'
    const path = seed.path ?? `/worktrees/${seed.name}`
    const worktree: FakeWorktree = {
      id: `${repoId}::${path}`,
      repoId,
      projectId: seed.projectId ?? 'git:gitlab.example.com/acme/api',
      path,
      isMainWorktree: seed.isMainWorktree ?? false,
      branch: fullRef(seed.branch === undefined ? seed.name : seed.branch),
      displayName: seed.name,
      linkedGitLabMR: seed.legacyGitLabMR ?? mrIid(seed.references?.[0]),
      linkedItems: [
        ...(seed.references ?? []).map((url) => linkedItem(url)),
        ...(seed.linearIssue ? [{ provider: 'linear', type: 'issue', ...seed.linearIssue }] : [])
      ],
      ...(seed.baseRef ? { baseRef: seed.baseRef } : {}),
      diffComments: [],
      dirty: seed.dirty ?? false
    }
    this.#worktrees.push(worktree)
    return publicRow(worktree)
  }

  addRepo(seed: RepoSeed): Worktree {
    return this.addWorktree({
      name: seed.path.split('/').at(-1) ?? seed.repoId,
      repoId: seed.repoId,
      projectId: seed.projectId,
      path: seed.path,
      branch: seed.branch ?? 'main',
      isMainWorktree: true
    })
  }

  setDiffComments(worktreeId: string, comments: DiffComment[]): void {
    this.#byId(worktreeId).diffComments = comments
  }

  setDirty(worktreeId: string, dirty = true): void {
    this.#byId(worktreeId).dirty = dirty
  }

  /** The agents `orca worktree ps` reports in a worktree, by state (`working`, `done`…). */
  setAgents(worktreeId: string, states: string[]): void {
    this.#byId(worktreeId)
    this.#agents.set(worktreeId, states)
  }

  /** While true, `orca worktree ps` fails (and only it). */
  failAgents = false

  /** The next calls reject with these errors, one each. */
  failNext(...errors: OrcaCliError[]): void {
    this.#failures.push(...errors)
  }

  // --- OrcaCli -----------------------------------------------------------------------------

  async listWorktrees(): Promise<Worktree[]> {
    this.#record('worktree list')
    return this.#worktrees.map(publicRow)
  }

  async listAgents(): Promise<WorktreeAgents[]> {
    this.#record('worktree ps')
    if (this.failAgents) throw new OrcaCliError('unavailable', 'The orca CLI failed (exit 1): ps broke')
    return this.#worktrees.map((w) => ({
      worktreeId: w.id,
      agents: (this.#agents.get(w.id) ?? []).map((state) => ({ state, agentType: 'claude' }))
    }))
  }

  async showWorktree(selector: string): Promise<WorktreeDetail> {
    this.#record('worktree show', { selector })
    const { dirty: _dirty, ...detail } = this.#select(selector)
    return structuredClone(detail)
  }

  async createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
    this.#record('worktree create', input)
    if (input.references && input.gitlabMr) {
      throw new OrcaCliError('invalid_argument', '--reference cannot be combined with legacy link flags')
    }
    const repo = input.repo ? this.#repo(input.repo) : undefined
    const mr = input.gitlabMr ?? input.references?.[0]
    if (repo && mr && !sameProject(repo.projectId, mr)) {
      throw new OrcaCliError('invalid_argument', `${mr} does not belong to ${repo.projectId}`)
    }
    return this.addWorktree({
      name: input.name,
      ...(repo ? { repoId: repo.repoId, projectId: repo.projectId } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      // Orca stores `compareBaseRef ?? remoteTrackingBase?.ref ?? baseBranch`; the CLI sends no
      // compareBaseRef, and for `origin/<branch>` remoteTrackingBase.ref is that same name (#54).
      ...(input.baseBranch ? { baseRef: input.baseBranch } : {}),
      ...(input.references ? { references: input.references } : {}),
      ...(input.gitlabMr ? { references: [input.gitlabMr] } : {})
    })
  }

  async removeWorktree(selector: string, options: RemoveWorktreeOptions = {}): Promise<void> {
    this.#record('worktree rm', { selector, ...options })
    const worktree = this.#select(selector)
    if (worktree.dirty && !options.force) {
      throw new OrcaCliError('worktree_dirty', `${worktree.path} has uncommitted changes`)
    }
    this.#worktrees = this.#worktrees.filter((w) => w !== worktree)
  }

  // --- internals ---------------------------------------------------------------------------

  #record(command: string, args?: unknown): void {
    this.calls.push(args === undefined ? { command } : { command, args })
    const failure = this.#failures.shift()
    if (failure) throw failure
  }

  #select(selector: string): FakeWorktree {
    const [form, ...rest] = selector.split(':')
    const value = rest.join(':')
    const found =
      form === 'id'
        ? this.#worktrees.find((w) => w.id === value)
        : form === 'path'
          ? this.#worktrees.find((w) => w.path === value)
          : undefined
    if (!found) throw new OrcaCliError('selector_not_found', `No worktree matches ${selector}`)
    return found
  }

  /** `id:<repoId>`: the repo's main worktree. */
  #repo(selector: string): FakeWorktree {
    const repoId = selector.replace(/^id:/, '')
    const found = this.#worktrees.find((w) => w.isMainWorktree && w.repoId === repoId)
    if (!found) throw new OrcaCliError('selector_not_found', `No repo matches ${selector}`)
    return found
  }

  #byId(id: string): FakeWorktree {
    const found = this.#worktrees.find((w) => w.id === id)
    if (!found) throw new Error(`fake orca CLI has no worktree ${id}`)
    return found
  }
}

function publicRow(w: FakeWorktree): Worktree {
  return {
    id: w.id,
    repoId: w.repoId,
    projectId: w.projectId,
    path: w.path,
    isMainWorktree: w.isMainWorktree,
    branch: w.branch,
    linkedGitLabMR: w.linkedGitLabMR,
    displayName: w.displayName,
    linkedItems: w.linkedItems.map((l) => ({ ...l }))
  }
}

/** Orca refuses a GitLab URL of another project than the repo's (`git:<host>/<path>`). */
function sameProject(projectId: string, mrUrl: string): boolean {
  const match = /^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\//.exec(mrUrl)
  return match !== null && projectId.toLowerCase() === `git:${match[1]}/${match[2]}`.toLowerCase()
}

function fullRef(branch: string | null): string | null {
  return branch === null || branch.startsWith('refs/') ? branch : `refs/heads/${branch}`
}

function mrIid(url: string | undefined): number | null {
  const iid = url ? /\/merge_requests\/(\d+)/.exec(url)?.[1] : undefined
  return iid ? Number(iid) : null
}

function linkedItem(url: string) {
  const iid = mrIid(url)
  return { provider: 'gitlab', type: 'mr', url, ...(iid === null ? {} : { number: iid }) }
}
