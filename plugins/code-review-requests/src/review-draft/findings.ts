// The findings.json contract (#29). An Agent Review writes `.orca-review/findings.json` in its
// Review Workspace (the default Review Prompt in settings.ts tells it how):
//
//   {
//     "headSha": "<git rev-parse HEAD when reviewing>",          // optional
//     "findings": [
//       { "path": "src/a.ts", "line": 12, "body": "…" },          // a line of the new file
//       { "path": "src/a.ts", "startLine": 10, "line": 14, "body": "…" },  // a range
//       { "body": "…" }                                           // a general comment
//     ]
//   }
//
// A bare array of findings is accepted too. Bad entries are skipped, each with a warning (#15).
import { messageOf } from '../errors'

/** The file the Agent Review writes, relative to its Review Workspace. */
export const FINDINGS_FILE = '.orca-review/findings.json'

/** One Agent Finding as read from the file. `filePath` null means a general comment. */
export type AgentFinding = {
  filePath: string | null
  startLine?: number
  line: number | null
  body: string
}

export type ParsedFindings = {
  /** The commit the Agent Review looked at, if it said. */
  headSha: string | null
  findings: AgentFinding[]
  /** One line per skipped entry, or for a file that can't be read at all. */
  warnings: string[]
}

export function parseFindings(text: string): ParsedFindings {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { headSha: null, findings: [], warnings: [`findings.json isn't valid JSON: ${messageOf(error)}`] }
  }
  const record = isObject(data) ? data : null
  const list = Array.isArray(data) ? data : record?.findings
  const headSha = typeof record?.headSha === 'string' && record.headSha.trim() !== '' ? record.headSha.trim() : null
  if (!Array.isArray(list)) return { headSha, findings: [], warnings: ['findings.json has no "findings" list.'] }

  const findings: AgentFinding[] = []
  const warnings: string[] = []
  list.forEach((entry, index) => {
    const result = findingOf(entry)
    if (typeof result === 'string') warnings.push(`Agent Finding ${index + 1} skipped: ${result}.`)
    else findings.push(result)
  })
  return { headSha, findings, warnings }
}

/** The finding, or why the entry is skipped. */
function findingOf(entry: unknown): AgentFinding | string {
  if (!isObject(entry)) return 'not an object'
  const { path, line, startLine, body } = entry
  if (typeof body !== 'string' || body.trim() === '') return 'no body'
  if (path !== undefined && path !== null && typeof path !== 'string') return 'path must be text'
  const filePath = typeof path === 'string' && path.trim() !== '' ? path.trim() : null
  if (line !== undefined && line !== null && !isLineNumber(line)) return 'line must be a whole number from 1'
  if (startLine !== undefined && startLine !== null && !isLineNumber(startLine)) {
    return 'startLine must be a whole number from 1'
  }
  const at = isLineNumber(line) ? line : null
  if (at !== null && filePath === null) return 'a line needs a path'
  if (isLineNumber(startLine) && (at === null || startLine > at)) {
    return at === null ? 'startLine needs a line' : 'startLine is after line'
  }
  return {
    filePath,
    ...(isLineNumber(startLine) && startLine !== at ? { startLine } : {}),
    line: at,
    body: body.trim()
  }
}

function isLineNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
