// Building, writing and opening a Review Workspace's Review Cover Page (#55). The page is a
// snapshot of the checked-out commit: it is built once (on Start review, or by Open workspace or
// the Review Draft's "Cover page" when it is missing) from GitLab REST, never by the poll, and not
// rebuilt on open.
//
// It lives at `.orca-review/merge-request.md` in the worktree, beside the Agent Review's
// findings.json. `.orca-review/` goes into the exclude file git reads for the worktree (for a
// linked worktree, the main repo's `.git/info/exclude`), so Source Control never lists it.
import type { OrcaWorkerApi } from 'orca/worker'
import { messageOf } from '../errors'
import { redactError } from '../gitlab/http-response'
import type { Files } from '../seams/files'
import type { Git } from '../seams/git'
import type { GitLabAccess, GitLabTransport } from '../seams/gitlab'
import type { LinkedItem } from '../seams/orca-cli'
import { hostWorkspaceIdOf } from '../workspaces/host-workspace'
import {
  renderCoverPage,
  type CoverPageSource,
  type LinearLink,
  type RestApprovals,
  type RestDiff,
  type RestMergeRequest
} from './render'

/** Where the page lives, relative to the worktree. */
const COVER_PAGE_PATH = '.orca-review/merge-request.md'
const EXCLUDE_LINE = '.orca-review/'
const DIFFS_PER_PAGE = 100
/** GitLab's diff limits keep an MR far below this; past it the page says the list is cut short. */
const MAX_DIFF_PAGES = 50

/** Which merge request, the Review Workspace it belongs to, and that workspace's Linear link. */
export type CoverPageTarget = {
  projectPath: string
  iid: number
  workspace: { name: string; path: string }
  linear: LinearLink | null
}

/** The target for a merge request's Review Workspace; Orca's linked items give its Linear link. */
export function coverPageTargetOf(
  mr: { projectPath: string; iid: number },
  workspace: { name: string; path: string; linkedItems?: LinkedItem[] }
): CoverPageTarget {
  const item = workspace.linkedItems?.find((i) => i.provider === 'linear' && i.identifier !== undefined)
  return {
    projectPath: mr.projectPath,
    iid: mr.iid,
    workspace: { name: workspace.name, path: workspace.path },
    linear: item === undefined ? null : { identifier: item.identifier!, url: item.url }
  }
}

export type CoverPages = {
  /** Builds the page unless the workspace has one; true when it built it now. */
  ensure(target: CoverPageTarget): Promise<boolean>
  /** Shows the page in an editor tab in Orca's main view. */
  reveal(target: CoverPageTarget): Promise<void>
  /** Builds the page if missing, then shows it. */
  open(target: CoverPageTarget): Promise<void>
  /** After Open workspace: builds and shows the page only when the workspace has none. */
  openIfMissing(target: CoverPageTarget): Promise<void>
}

export function createCoverPages(deps: {
  git: Git
  files: Files
  host: OrcaWorkerApi['host']
  gitLab: () => Promise<GitLabAccess>
}): CoverPages {
  const pagePath = (target: CoverPageTarget) => `${target.workspace.path}/${COVER_PAGE_PATH}`

  async function ensure(target: CoverPageTarget): Promise<boolean> {
    if ((await deps.files.readText(pagePath(target))) !== null) return false
    const { transport, token } = await deps.gitLab()
    const [headSha, gitLab] = await Promise.all([
      deps.git.headSha(target.workspace.path),
      fetchFromGitLab(transport, target).catch((error: unknown) => {
        throw redactError(error, token)
      })
    ])
    await excludeReviewFolder(target.workspace.path)
    const source: CoverPageSource = { projectPath: target.projectPath, headSha, linear: target.linear, ...gitLab }
    await deps.files.writeText(pagePath(target), renderCoverPage(source))
    return true
  }

  async function excludeReviewFolder(worktreePath: string): Promise<void> {
    const exclude = await deps.git.gitPath(worktreePath, 'info/exclude')
    const current = (await deps.files.readText(exclude)) ?? ''
    if (current.split('\n').some((line) => line.trim() === EXCLUDE_LINE)) return
    const separator = current === '' || current.endsWith('\n') ? '' : '\n'
    await deps.files.writeText(exclude, `${current}${separator}${EXCLUDE_LINE}\n`)
  }

  async function reveal(target: CoverPageTarget): Promise<void> {
    const workspaceId = await hostWorkspaceIdOf(deps.host, target.workspace)
    await deps.host.call('editor.open', { workspaceId, path: COVER_PAGE_PATH })
  }

  return {
    ensure,
    reveal,
    async open(target) {
      await ensure(target)
      await reveal(target)
    },
    async openIfMissing(target) {
      try {
        if (await ensure(target)) await reveal(target)
      } catch (error) {
        throw new Error(`The workspace is open, but its Review Cover Page wasn't built: ${messageOf(error)}`)
      }
    }
  }
}

/** The MR, its changed files and its approvals (null when GitLab won't say), via REST. */
async function fetchFromGitLab(
  transport: GitLabTransport,
  target: { projectPath: string; iid: number }
): Promise<Pick<CoverPageSource, 'mr' | 'diffs' | 'diffsTruncated' | 'approvals'>> {
  const base = `/projects/${encodeURIComponent(target.projectPath)}/merge_requests/${target.iid}`
  const allDiffs = async (): Promise<{ diffs: RestDiff[]; truncated: boolean }> => {
    const diffs: RestDiff[] = []
    for (let page = 1; page <= MAX_DIFF_PAGES; page++) {
      const batch = await transport.rest<RestDiff[]>('GET', `${base}/diffs?page=${page}&per_page=${DIFFS_PER_PAGE}`)
      diffs.push(...batch)
      if (batch.length < DIFFS_PER_PAGE) return { diffs, truncated: false }
    }
    return { diffs, truncated: true }
  }
  const [mr, { diffs, truncated }, approvals] = await Promise.all([
    transport.rest<RestMergeRequest>('GET', base),
    allDiffs(),
    transport.rest<RestApprovals>('GET', `${base}/approvals`).catch(() => null)
  ])
  return { mr, diffs, diffsTruncated: truncated, approvals }
}
