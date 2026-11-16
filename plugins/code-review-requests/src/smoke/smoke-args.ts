// The live smoke script's command line (#31). Without flags it only reads; `--post` writes a
// Review Draft to the one MR named by `--mr`, and only `--approve` on top of that approves it.
import { normalizeMergeRequestUrl } from '../workspaces/review-workspaces'

/** The MR a `--post` run writes to. */
export type SmokeTarget = { url: string; host: string; projectPath: string; iid: number }

export type SmokeArgs =
  | { mode: 'help' }
  | { mode: 'read-only'; host: string | null; glabPath: string | null }
  | {
      mode: 'post'
      target: SmokeTarget
      approve: boolean
      /** Where the line comment goes; null picks the first added line of the MR's diff. */
      line: { path: string; line: number } | null
      /** Skip the confirmation prompt. */
      yes: boolean
      glabPath: string | null
    }

export const SMOKE_USAGE = `Live smoke test of the code-review-requests plugin against your real GitLab and Orca.

  npm run smoke                       read-only checks (glab, GitLab queries, orca CLI shapes)
  npm run smoke -- --host <host>      ... against this GitLab host (default: glab's first login)
  npm run smoke -- --post --mr <url>  publish a two-comment Review Draft to that one MR
                   [--approve]        ... and approve it (off by default)
                   [--file <path> --line <n>]  where the line comment goes (default: first added line)
                   [--yes]            ... without asking first
  --glab <path>                       the glab binary (default: PATH and the usual install folders)`

export function parseSmokeArgs(argv: string[]): SmokeArgs {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (['--help', '-h', '--post', '--approve', '--yes'].includes(arg)) {
      flags.add(arg === '-h' ? '--help' : arg)
    } else if (['--host', '--glab', '--mr', '--file', '--line'].includes(arg)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      values.set(arg, value)
    } else {
      throw new Error(`Unknown option ${arg}`)
    }
  }
  if (flags.has('--help')) return { mode: 'help' }
  const glabPath = values.get('--glab') ?? null

  if (!flags.has('--post')) {
    for (const writeOnly of ['--mr', '--approve', '--file', '--line', '--yes']) {
      if (flags.has(writeOnly) || values.has(writeOnly)) throw new Error(`${writeOnly} only goes with --post`)
    }
    return { mode: 'read-only', host: values.get('--host') ?? null, glabPath }
  }

  const url = values.get('--mr')
  if (url === undefined) throw new Error('--post needs --mr <merge request URL>: it never picks an MR itself')
  const target = targetOf(url)
  const file = values.get('--file')
  const lineText = values.get('--line')
  if ((file === undefined) !== (lineText === undefined)) throw new Error('--file and --line go together')
  let line: { path: string; line: number } | null = null
  if (file !== undefined && lineText !== undefined) {
    const n = Number(lineText)
    if (!Number.isInteger(n) || n < 1) throw new Error('--line must be a positive whole number')
    line = { path: file, line: n }
  }
  return { mode: 'post', target, approve: flags.has('--approve'), line, yes: flags.has('--yes'), glabPath }
}

function targetOf(url: string): SmokeTarget {
  const normalized = normalizeMergeRequestUrl(url)
  const match = normalized === null ? null : /^https?:\/\/([^/]+)\/(.+)\/-\/merge_requests\/(\d+)$/.exec(normalized)
  if (normalized === null || match === null) {
    throw new Error(`${url} is not a merge request URL (https://<host>/<project>/-/merge_requests/<iid>)`)
  }
  return { url: normalized, host: match[1]!, projectPath: match[2]!, iid: Number(match[3]) }
}
