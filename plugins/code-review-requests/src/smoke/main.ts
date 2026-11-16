// The live smoke script (#31), run by hand outside Orca: `npm run smoke` (read-only) or
// `npm run smoke -- --post --mr <url>`. See the README. It wires the real glab, GitLab and orca
// CLI into the checks in read-only-checks.ts and post-smoke.ts; it is never loaded by the plugin.
import { createInterface } from 'node:readline/promises'
import { realDeps } from '../deps'
import { messageOf } from '../errors'
import { isExecutable, spawnGlab } from '../gitlab/glab-process'
import { locateGlab } from '../gitlab/glab-transport'
import { spawnOrca } from '../orca-cli-process'
import { runPostSmoke } from './post-smoke'
import { formatReport, runReadOnlyChecks, type Check } from './read-only-checks'
import { parseSmokeArgs, SMOKE_USAGE, type SmokeArgs } from './smoke-args'

async function main(argv: string[]): Promise<number> {
  let args: SmokeArgs
  try {
    args = parseSmokeArgs(argv)
  } catch (error) {
    console.error(`${messageOf(error)}\n\n${SMOKE_USAGE}`)
    return 2
  }
  if (args.mode === 'help') {
    console.log(SMOKE_USAGE)
    return 0
  }
  const glabPath = args.glabPath
  const gitLab = (host: string) => realDeps().gitLab({ host, token: null, glabPath })

  if (args.mode === 'read-only') {
    console.log('Read-only smoke test: nothing is written to GitLab or Orca.\n')
    const checks = await runReadOnlyChecks(
      {
        locateGlab: () => locateGlab(process.env, isExecutable, glabPath),
        // glab writes the status to stderr and exits 1 when any login fails.
        glabAuthStatus: async (glab) => {
          const run = await spawnGlab(glab, ['auth', 'status'], undefined)
          return `${run.stdout}\n${run.stderr}`
        },
        gitLab,
        runOrca: spawnOrca
      },
      { host: args.host }
    )
    return report(checks)
  }

  const { target } = args
  console.log(`Posting smoke test: writes one review to ${target.url} and nothing else.\n`)
  const result = await runPostSmoke({
    transport: gitLab(target.host),
    target,
    approve: args.approve,
    line: args.line,
    tag: `crr-smoke-${Date.now().toString(36)}`,
    now: () => Date.now(),
    confirm: async (plan) => {
      console.log(`${plan}\n`)
      if (args.mode === 'post' && args.yes) return true
      const prompt = createInterface({ input: process.stdin, output: process.stdout })
      const answer = await prompt.question('Type "post" to go ahead, anything else cancels: ')
      prompt.close()
      return answer.trim() === 'post'
    }
  })
  if (result.outcome === 'cancelled') {
    console.log('Cancelled: nothing was written.')
    return 1
  }
  return report(result.checks)
}

function report(checks: Check[]): number {
  console.log(formatReport(checks))
  return checks.some((c) => c.status === 'fail') ? 1 : 0
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Smoke test stopped: ${messageOf(error)}`)
    process.exit(1)
  }
)
