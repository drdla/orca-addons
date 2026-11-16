// The live smoke script's command line (#31): read-only unless --post names exactly one MR, and
// approving is its own flag on top of that.
import { assert, test } from 'orca/testing'
import { parseSmokeArgs } from './smoke-args'

const MR = 'https://gitlab.example.com/acme/team/api/-/merge_requests/7'

test('no flags is the read-only run', () => {
  assert.deepEqual(parseSmokeArgs([]), { mode: 'read-only', host: null, glabPath: null })
  assert.deepEqual(parseSmokeArgs(['--host', 'gitlab.example.com', '--glab', '/opt/homebrew/bin/glab']), {
    mode: 'read-only',
    host: 'gitlab.example.com',
    glabPath: '/opt/homebrew/bin/glab'
  })
})

test('--post --mr targets that one MR, without approving', () => {
  assert.deepEqual(parseSmokeArgs(['--post', '--mr', `${MR}/diffs`]), {
    mode: 'post',
    target: { url: MR, host: 'gitlab.example.com', projectPath: 'acme/team/api', iid: 7 },
    approve: false,
    line: null,
    yes: false,
    glabPath: null
  })
})

test('--approve, --file/--line and --yes are passed through', () => {
  const args = parseSmokeArgs(['--post', '--mr', MR, '--approve', '--file', 'src/a.ts', '--line', '12', '--yes'])
  assert.equal(args.mode, 'post')
  if (args.mode !== 'post') return
  assert.equal(args.approve, true)
  assert.deepEqual(args.line, { path: 'src/a.ts', line: 12 })
  assert.equal(args.yes, true)
})

test('refuses to post without an explicit MR, and refuses write flags without --post', () => {
  const refusals: [string[], RegExp][] = [
    [['--post'], /--post needs --mr/],
    [['--mr', MR], /--mr only goes with --post/],
    [['--approve'], /--approve only goes with --post/],
    [['--post', '--mr', MR, '--line', '3'], /--file and --line go together/],
    [['--post', '--mr', MR, '--file', 'a.ts', '--line', 'x'], /--line must be a positive whole number/],
    [['--post', '--mr', 'https://gitlab.example.com/acme/api'], /not a merge request URL/],
    [['--host'], /--host needs a value/],
    [['--nope'], /Unknown option --nope/]
  ]
  for (const [argv, message] of refusals) {
    assert.throws(() => parseSmokeArgs(argv), message)
  }
})

test('--help asks for the usage', () => {
  assert.deepEqual(parseSmokeArgs(['--help']), { mode: 'help' })
})
