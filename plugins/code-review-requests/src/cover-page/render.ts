// The review cover page (#55): a read-only Markdown snapshot of a merge request that a Review
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

/** `GET …/approvals`, only the fields read. */
export type RestApprovals = {
  approvals_required?: number | null
  approvals_left?: number | null
  approved_by?: { user: { username: string; name: string } }[]
}

export type CoverPageSource = {
  mr: RestMergeRequest
  diffs: RestDiff[]
  /** Null when GitLab didn't answer them. */
  approvals: RestApprovals | null
}

/** The comment that records which head commit the page was built from. */
export const HEAD_MARKER = 'orca-review-cover-page head='

export function renderCoverPage(source: CoverPageSource): string {
  const { mr, diffs } = source
  const reference = mr.references?.full ?? `!${mr.iid}`
  const lines = [
    `# ${mr.title}`,
    '',
    `[${reference}](${mr.web_url}) by ${mr.author.name} (@${mr.author.username})`,
    '',
    '| | |',
    '| --- | --- |',
    `| Branches | ${code(mr.source_branch)} → ${code(mr.target_branch)} |`,
    `| Labels | ${mr.labels.length === 0 ? 'none' : cell(mr.labels.join(', '))} |`,
    `| Linear ticket | ${linearTicketOf(mr)} |`,
    `| Pipeline | ${pipelineOf(mr)} |`,
    `| Approvals | ${approvalsOf(source.approvals)} |`,
    '',
    '## Description',
    '',
    descriptionOf(mr),
    '',
    `## Changed files (${diffs.length})`,
    '',
    'To step through the diffs, open Source Control → "Committed on Branch".',
    '',
    '| File | Change | Added | Removed |',
    '| --- | --- | --- | --- |',
    ...diffs.map(fileRow),
    '',
    '---',
    '',
    `A snapshot of ${reference} at commit ${code(mr.sha.slice(0, 8))}: it doesn't change when the merge request does.`,
    '',
    `<!-- ${HEAD_MARKER}${mr.sha} -->`,
    ''
  ]
  return lines.join('\n')
}

function descriptionOf(mr: RestMergeRequest): string {
  const text = (mr.description ?? '').trim()
  return text === '' ? '_No description._' : withUploadLinks(text, mr.web_url)
}

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)(\{[^}\n]*\})?/g
const MARKDOWN_LINK = /(?<!!)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const HTML_IMAGE = /<img\b[^>]*>/gi

/**
 * GitLab uploads (`/uploads/<secret>/<file>`) need a GitLab login, so an image of one becomes a
 * link to it (`[Image: alt](…)`), and a relative link to one becomes absolute. Other images stay.
 */
function withUploadLinks(text: string, mrWebUrl: string): string {
  const uploadUrl = (url: string): string | null => {
    const projectUrl = mrWebUrl.replace(/\/-\/merge_requests\/.*$/, '')
    const origin = new URL(mrWebUrl).origin
    if (url.startsWith('/uploads/')) return `${projectUrl}${url}`
    if (url.startsWith('/') && url.includes('/uploads/')) return `${origin}${url}`
    if (url.startsWith(`${origin}/`) && url.includes('/uploads/')) return url
    return null
  }
  const imageLink = (alt: string, url: string): string => {
    const label = alt.trim() !== '' ? alt.trim() : decodeURIComponent(url.split('/').at(-1) ?? 'image')
    return `[Image: ${label}](${url})`
  }
  return text
    .replace(MARKDOWN_IMAGE, (whole, alt: string, url: string) => {
      const absolute = uploadUrl(url)
      return absolute === null ? whole : imageLink(alt, absolute)
    })
    .replace(MARKDOWN_LINK, (whole, label: string, url: string) => {
      const absolute = uploadUrl(url)
      return absolute === null ? whole : `[${label}](${absolute})`
    })
    .replace(HTML_IMAGE, (tag) => {
      const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1]
      const absolute = src === undefined ? null : uploadUrl(src)
      if (absolute === null) return tag
      return imageLink(/\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '', absolute)
    })
}

/** A row of the changed-file list. No links: plugins can't open a per-file branch diff. */
function fileRow(diff: RestDiff): string {
  const path = diff.renamed_file ? `${code(diff.old_path)} → ${code(diff.new_path)}` : code(diff.new_path)
  const change = diff.new_file ? 'added' : diff.deleted_file ? 'deleted' : diff.renamed_file ? 'renamed' : 'modified'
  // GitLab sends no diff for a binary, too large or collapsed file; a pure rename has none either.
  const known = diff.diff !== '' || (diff.renamed_file && !diff.too_large && !diff.collapsed)
  if (!known || diff.too_large) return `| ${path} | ${change} | ? | ? |`
  // GitLab's `diff` starts at the first hunk (no ---/+++ header), so every +/- line counts.
  const lines = diff.diff.split('\n')
  const added = lines.filter((l) => l.startsWith('+')).length
  const removed = lines.filter((l) => l.startsWith('-')).length
  return `| ${path} | ${change} | +${added} | -${removed} |`
}

const LINEAR_URL = /https:\/\/linear\.app\/[^/\s)]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)[^\s)>\]]*/
/** `<team key>-<number>` as Linear Board Sync reads a branch name, keys of 2–5 letters only. */
const LINEAR_IDENTIFIER = /(?<![A-Za-z0-9])([A-Za-z]{2,5})-(\d+)(?![0-9])/

/** A Linear link in the description, else an issue identifier in the source branch, else none. */
function linearTicketOf(mr: RestMergeRequest): string {
  const link = LINEAR_URL.exec(mr.description ?? '')
  if (link) return `[${link[1]!.toUpperCase()}](${link[0]})`
  const identifier = LINEAR_IDENTIFIER.exec(mr.source_branch)
  return identifier ? `${identifier[1]!.toUpperCase()}-${identifier[2]}` : 'none'
}

function pipelineOf(mr: RestMergeRequest): string {
  const status = mr.head_pipeline?.status
  if (!status) return 'none'
  return status === 'success' ? 'passed' : status
}

function approvalsOf(approvals: RestApprovals | null): string {
  if (approvals === null) return 'unknown'
  const by = (approvals.approved_by ?? []).map((a) => a.user.name)
  const required = approvals.approvals_required ?? 0
  if (required <= 0 && by.length === 0) return 'none required'
  const given = required - (approvals.approvals_left ?? required)
  return `${given} of ${required}${by.length === 0 ? '' : ` (${cell(by.join(', '))})`}`
}

/** Inline code that survives a table cell. */
function code(text: string): string {
  return `\`${cell(text)}\``
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
