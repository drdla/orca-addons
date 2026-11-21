// Building, writing and opening a Review Workspace's review cover page (#55). The page is a
// snapshot: it is built once (on Start review, or by Open workspace or the Review Draft's
// "Cover page" when it is missing) from GitLab REST, never by the poll, and not rebuilt on open.
//
// It lives at `.orca-review/merge-request.md` in the worktree, beside the Agent Review's
// findings.json. `.orca-review/` goes into the exclude file git reads for the worktree (for a
// linked worktree, the main repo's `.git/info/exclude`), so Source Control never lists it.
import type { OrcaWorkerApi } from 'orca/worker'
import { redactError } from '../gitlab/http-response'
import type { Files } from '../seams/files'
import type { Git } from '../seams/git'
import type { GitLabTransport } from '../seams/gitlab'
import { hostWorkspaceIdOf } from '../workspaces/review-actions'
import { renderCoverPage, type CoverPageSource, type RestApprovals, type RestDiff, type RestMergeRequest } from './render'

/** Where the page lives, relative to the worktree. */
export const COVER_PAGE_PATH = '.orca-review/merge-request.md'
const EXCLUDE_LINE = '.orca-review/'
const DIFFS_PER_PAGE = 100
/** GitLab's diff limits keep an MR far below this; it only stops a runaway loop. */
const MAX_DIFF_PAGES = 50

/** Which merge request, and the Review Workspace it belongs to. */
export type CoverPageTarget = { projectPath: string; iid: number; workspace: { name: string; path: string } }

export type CoverPages = {
  /** Builds the page unless the workspace has one; true when it built it now. */
  ensure(target: CoverPageTarget): Promise<boolean>
  /** Builds the page if missing, then opens it in an editor tab in Orca's main view. */
  open(target: CoverPageTarget): Promise<void>
}

export function createCoverPages(deps: {
  git: Git
  files: Files
  host: OrcaWorkerApi['host']
  /** The transport for the configured connection, and its token (to redact), or null for glab. */
  gitLab: () => Promise<{ transport: GitLabTransport; token: string | null }>
}): CoverPages {
  const pagePath = (target: CoverPageTarget) => `${target.workspace.path}/${COVER_PAGE_PATH}`

  async function ensure(target: CoverPageTarget): Promise<boolean> {
    if ((await deps.files.readText(pagePath(target))) !== null) return false
    const { transport, token } = await deps.gitLab()
    let source: CoverPageSource
    try {
      source = await fetchCoverPageSource(transport, target)
    } catch (error) {
      throw redactError(error, token)
    }
    await excludeReviewFolder(target.workspace.path)
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

  return {
    ensure,
    async open(target) {
      await ensure(target)
      const workspaceId = await hostWorkspaceIdOf(deps.host, target.workspace)
      await deps.host.call('editor.open', { workspaceId, path: COVER_PAGE_PATH })
    }
  }
}

/** The MR, all its changed files and its approvals (null when GitLab won't say), via REST. */
export async function fetchCoverPageSource(
  transport: GitLabTransport,
  target: { projectPath: string; iid: number }
): Promise<CoverPageSource> {
  const base = `/projects/${encodeURIComponent(target.projectPath)}/merge_requests/${target.iid}`
  const diffs = async (): Promise<RestDiff[]> => {
    const all: RestDiff[] = []
    for (let page = 1; page <= MAX_DIFF_PAGES; page++) {
      const batch = await transport.rest<RestDiff[]>('GET', `${base}/diffs?page=${page}&per_page=${DIFFS_PER_PAGE}`)
      all.push(...batch)
      if (batch.length < DIFFS_PER_PAGE) break
    }
    return all
  }
  const [mr, files, approvals] = await Promise.all([
    transport.rest<RestMergeRequest>('GET', base),
    diffs(),
    transport.rest<RestApprovals>('GET', `${base}/approvals`).catch(() => null)
  ])
  return { mr, diffs: files, approvals }
}
