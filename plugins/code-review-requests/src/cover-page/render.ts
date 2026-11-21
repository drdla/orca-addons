// The Review Cover Page (#55): a read-only Markdown snapshot of a merge request that a Review
// Workspace opens in Orca's main view, with everything to read before the code: title,
// description, metadata and the changed-file list. Pure: GitLab's REST answers in, Markdown out.
// Discussion threads and Agent Findings are left out on purpose.

/** `GET /projects/:id/merge_requests/:iid`, only the fields read. */
export type RestMergeRequest = {
  iid: number
  title: string
  description: string | null
  web_url: string
  author: { username: string; name: string }
  source_branch: string
  target_branch: string
  labels: string[]
  /** The MR's head commit on GitLab now. */
  sha: string
  head_pipeline?: { status: string } | null
  references?: { full: string }
}

/** One file of `GET …/diffs`, only the fields read. */
export type RestDiff = {
  old_path: string
  new_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
  too_large?: boolean
  collapsed?: boolean
}

/** `GET …/approvals`, only the fields read. GitLab CE may leave out the required count. */
export type RestApprovals = {
  approvals_required?: number | null
  approvals_left?: number | null
  approved_by?: { user: { username: string; name: string } }[]
}

/** A Linear ticket the Review Workspace itself links to. */
export type LinearLink = { identifier: string; url: string }

export type CoverPageSource = {
  /** The MR's project path, for example `acme/api`. */
  projectPath: string
  /** The commit checked out in the Review Workspace: what the page is a snapshot of. */
  headSha: string
  /** The workspace's own Linear link, or null. */
  linear: LinearLink | null
  mr: RestMergeRequest
  diffs: RestDiff[]
  /** True when GitLab had more diff pages than were read. */
  diffsTruncated: boolean
  /** Null when GitLab didn't answer them. */
  approvals: RestApprovals | null
}

export function renderCoverPage(source: CoverPageSource): string {
  const { mr, diffs } = source
  const reference = mr.references?.full ?? `${source.projectPath}!${mr.iid}`
  const page = [
    `# ${text(mr.title)}`,
    '',
    `[${text(reference)}](${mr.web_url}) by ${text(mr.author.name)} (@${text(mr.author.username)})`,
    '',
    '| | |',
    '| --- | --- |',
    `| Branches | ${code(mr.source_branch)} → ${code(mr.target_branch)} |`,
    `| Labels | ${mr.labels.length === 0 ? 'none' : cell(mr.labels.map(text).join(', '))} |`,
    `| Linear ticket | ${linearTicketOf(source)} |`,
    `| Pipeline | ${pipelineOf(mr)} |`,
    `| Approvals | ${approvalsCell(source.approvals)} |`,
    '',
    '## Description',
    '',
    descriptionOf(source),
    '',
    `## Changed files (${diffs.length}${source.diffsTruncated ? ' shown' : ''})`,
    '',
    'To step through the diffs, open Source Control → "Committed on Branch".',
    ...(source.diffsTruncated ? ['', 'The list is cut short: GitLab has more changed files than the page shows.'] : []),
    '',
    '| File | Change | Added | Removed |',
    '| --- | --- | --- | --- |',
    ...diffs.map(fileRow),
    '',
    '---',
    '',
    `A snapshot of ${text(reference)} at commit ${code(source.headSha.slice(0, 8))}: it doesn't change when the merge request does.`,
    '',
    `<!-- orca-review-cover-page head=${source.headSha} -->`,
    ''
  ].join('\n')
  // GitLab already has newer commits than the workspace: the page opens with the callout.
  return withUpdatedCallout(page, mr.sha)
}

// --- Merge request updated (#57) ---------------------------------------------------------------

const CALLOUT_START = '> **Merge request updated.**'
/** Where the callout goes: the line after the title and its blank line. */
const CALLOUT_LINE = 2
const HEAD_MARKER = /^<!-- orca-review-cover-page head=([0-9a-f]+) -->$/m

/** The commit a built page records (its head marker), or null for a page without one. */
export function coverPageHeadOf(page: string): string | null {
  return HEAD_MARKER.exec(page)?.[1] ?? null
}

/** The callout at the top of a page whose workspace is behind the merge request's head. */
function updatedCallout(gitLabHead: string, pageHead: string): string {
  return (
    `${CALLOUT_START} New commits were pushed since this workspace was checked out: ` +
    `GitLab is at ${code(gitLabHead.slice(0, 8))}, the workspace and this page at ${code(pageHead.slice(0, 8))}. ` +
    'Use "Update workspace" on its card in the Review Requests panel to review them.'
  )
}

/**
 * A built page with the "Merge request updated" callout as of `gitLabHead`, the merge request's
 * head the last poll saw: added below the title while the page's recorded head differs, removed
 * once they match. Without the plugin's head marker the page is left as it is.
 */
export function withUpdatedCallout(page: string, gitLabHead: string): string {
  const pageHead = coverPageHeadOf(page)
  if (pageHead === null) return page
  const lines = page.split('\n')
  // The callout and the blank line after it.
  if (lines[CALLOUT_LINE]?.startsWith(CALLOUT_START)) lines.splice(CALLOUT_LINE, 2)
  if (gitLabHead !== pageHead) lines.splice(CALLOUT_LINE, 0, updatedCallout(gitLabHead, pageHead), '')
  return lines.join('\n')
}

function descriptionOf(source: CoverPageSource): string {
  const description = (source.mr.description ?? '').trim()
  return description === '' ? '_No description._' : withUploadLinks(description, uploadBase(source))
}

// --- Uploads -----------------------------------------------------------------------------------

/** Where uploads resolve: the project's URL and the instance's (with any sub-path install). */
type UploadBase = { project: string; instance: string }

function uploadBase(source: CoverPageSource): UploadBase {
  const project = source.mr.web_url.replace(/\/-\/merge_requests\/.*$/, '')
  const suffix = `/${source.projectPath}`
  const instance = project.endsWith(suffix) ? project.slice(0, -suffix.length) : new URL(project).origin
  return { project, instance }
}

/** The absolute URL of a GitLab upload, or null when `url` is no upload. */
function uploadUrl(url: string, base: UploadBase): string | null {
  if (url.startsWith(`${base.instance}/`)) return url.includes('/uploads/') ? url : null
  if (!url.startsWith('/') || url.startsWith('//')) return null
  if (url.startsWith('/uploads/')) return `${base.project}${url}`
  if (!url.includes('/uploads/')) return null
  // Already carrying a sub-path install's prefix (`/gitlab/-/project/…`), or relative to it.
  const prefix = new URL(base.instance).pathname.replace(/\/$/, '')
  if (prefix !== '' && url.startsWith(`${prefix}/`)) return `${new URL(base.instance).origin}${url}`
  return `${base.instance}${url}`
}

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)(\{[^}\n]*\})?/g
const MARKDOWN_LINK = /(?<!!)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g
const HTML_IMAGE = /<img\b[^>]*>/gi
/** `[label]: url "title"`, a reference-style link definition. */
const DEFINITION = /^( {0,3}\[([^\]]+)\]:\s*)<?(\S+?)>?(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/gm
/** `![alt][label]`, `![alt][]` and `![alt]` (shortcut), not followed by `(`. */
const REFERENCE_IMAGE = /!\[([^\]]*)\](?:\[([^\]]*)\])?(?![[(])/g

/**
 * GitLab uploads (`/uploads/<secret>/<file>`) need a GitLab login, so an image of one becomes a
 * link to it (`[Image: alt](…)`), and a relative link to one becomes absolute. Other images stay,
 * and so does anything in a fenced code block or a code span.
 */
function withUploadLinks(markdown: string, base: UploadBase): string {
  const uploadLabels = new Set<string>()
  for (const match of markdown.matchAll(DEFINITION)) {
    if (uploadUrl(match[3]!, base) !== null) uploadLabels.add(normalizeLabel(match[2]!))
  }
  return outsideCode(markdown, (prose) =>
    prose
      .replace(DEFINITION, (whole, start: string, _label: string, url: string, title: string | undefined) => {
        const absolute = uploadUrl(url, base)
        return absolute === null ? whole : `${start}${absolute}${title ?? ''}`
      })
      .replace(MARKDOWN_IMAGE, (whole, alt: string, url: string) => {
        const absolute = uploadUrl(url, base)
        return absolute === null ? whole : `[${imageLabel(alt, absolute)}](${absolute})`
      })
      .replace(REFERENCE_IMAGE, (whole, alt: string, label: string | undefined) => {
        const key = normalizeLabel(label === undefined || label === '' ? alt : label)
        if (!uploadLabels.has(key)) return whole
        return `[Image: ${alt}][${label === undefined || label === '' ? alt : label}]`
      })
      .replace(MARKDOWN_LINK, (whole, label: string, url: string, title: string) => {
        const absolute = uploadUrl(url, base)
        return absolute === null ? whole : `[${label}](${absolute}${title})`
      })
      .replace(HTML_IMAGE, (tag) => {
        const src = attribute(tag, 'src')
        const absolute = src === null ? null : uploadUrl(src, base)
        return absolute === null ? tag : `[${imageLabel(attribute(tag, 'alt') ?? '', absolute)}](${absolute})`
      })
  )
}

function imageLabel(alt: string, url: string): string {
  if (alt.trim() !== '') return `Image: ${alt.trim()}`
  const name = url.split('/').at(-1) ?? 'image'
  try {
    return `Image: ${decodeURIComponent(name)}`
  } catch {
    return `Image: ${name}`
  }
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match === null ? null : (match[1] ?? match[2] ?? null)
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Applies `rewrite` to the text outside fenced code blocks and code spans. */
function outsideCode(markdown: string, rewrite: (prose: string) => string): string {
  const out: string[] = []
  let prose: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (prose.length === 0) return
    out.push(withoutCodeSpans(prose.join('\n'), rewrite))
    prose = []
  }
  for (const line of markdown.split('\n')) {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence === null && opener !== undefined) {
      flush()
      fence = opener
      out.push(line)
    } else if (fence !== null) {
      out.push(line)
      if (line.trim().startsWith(fence[0]!.repeat(fence.length)) && line.trim().replace(/[`~]/g, '') === '') fence = null
    } else {
      prose.push(line)
    }
  }
  flush()
  return out.join('\n')
}

function withoutCodeSpans(prose: string, rewrite: (text: string) => string): string {
  const parts = prose.split(/(`+[^`]*?`+)/g)
  return parts.map((part, i) => (i % 2 === 1 ? part : rewrite(part))).join('')
}

// --- Metadata ----------------------------------------------------------------------------------

const LINEAR_URL = /https:\/\/linear\.app\/[^/\s)]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)[^\s)>\]]*/
/** `<team key>-<number>` at the start of the branch or a `/` segment, keys of 2–5 letters. */
const BRANCH_IDENTIFIER = /(?:^|\/)([A-Za-z]{2,5})-(\d+)(?![0-9])/
/** Look like a team key, but in a branch name they are almost always something else. */
const NOT_TEAM_KEYS = new Set(['UTF', 'SHA', 'ISO', 'CVE', 'RFC', 'HTTP', 'MD5'])

/** The workspace's own Linear link, a Linear link in the description, the branch name, or none. */
function linearTicketOf(source: CoverPageSource): string {
  if (source.linear !== null) return `[${text(source.linear.identifier)}](${source.linear.url})`
  const link = LINEAR_URL.exec(source.mr.description ?? '')
  if (link) return `[${link[1]!.toUpperCase()}](${link[0]})`
  const match = BRANCH_IDENTIFIER.exec(source.mr.source_branch)
  if (!match || NOT_TEAM_KEYS.has(match[1]!.toUpperCase())) return 'none'
  return `${match[1]!.toUpperCase()}-${match[2]}`
}

function pipelineOf(mr: RestMergeRequest): string {
  const status = mr.head_pipeline?.status
  if (!status) return 'none'
  return status === 'success' ? 'passed' : cell(text(status))
}

/** Who approved; out of the required number when GitLab requires any (CE may not say). */
function approvalsCell(approvals: RestApprovals | null): string {
  if (approvals === null) return 'unknown'
  const by = (approvals.approved_by ?? []).map((a) => text(a.user.name))
  const required = approvals.approvals_required ?? 0
  const names = by.length === 0 ? '' : ` (${cell(by.join(', '))})`
  if (required > 0) return `${by.length} of ${required}${names}`
  return by.length === 0 ? 'none' : `${by.length}${names}`
}

/** A row of the changed-file list. No links: plugins can't open a per-file branch diff. */
function fileRow(diff: RestDiff): string {
  const path = diff.renamed_file ? `${code(diff.old_path)} → ${code(diff.new_path)}` : code(diff.new_path)
  const change = diff.new_file ? 'added' : diff.deleted_file ? 'deleted' : diff.renamed_file ? 'renamed' : 'modified'
  const counts = countsOf(diff)
  return counts === null ? `| ${path} | ${change} | ? | ? |` : `| ${path} | ${change} | +${counts.added} | -${counts.removed} |`
}

/** Added and removed lines, or null when GitLab's answer doesn't tell (too large, binary…). */
function countsOf(diff: RestDiff): { added: number; removed: number } | null {
  if (diff.too_large || diff.collapsed || /^Binary files .* differ\s*$/.test(diff.diff)) return null
  if (diff.diff === '') {
    // An empty file added or deleted, or a pure rename, has no diff; anything else is unknown.
    return diff.new_file || diff.deleted_file || diff.renamed_file ? { added: 0, removed: 0 } : null
  }
  // GitLab's `diff` starts at the first hunk (no ---/+++ header), so every +/- line counts.
  const lines = diff.diff.split('\n')
  return { added: lines.filter((l) => l.startsWith('+')).length, removed: lines.filter((l) => l.startsWith('-')).length }
}

// --- Escaping ----------------------------------------------------------------------------------

/** Plain text with Markdown's special characters escaped. */
function text(value: string): string {
  return value.replace(/[\\`*_[\]<>#]/g, (c) => `\\${c}`).replace(/\n/g, ' ')
}

/** Inline code that survives a table cell: a fence longer than any backtick run inside. */
function code(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const padded = longest > 0 ? ` ${value} ` : value
  return `${fence}${cell(padded)}${fence}`
}

/** Text that can't break out of a table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
