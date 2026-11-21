// The git argument lists the real Git seam runs (#54).
import { assert, test } from 'orca/testing'
import {
  diffArgs,
  fetchBranchArgs,
  isAncestorArgs,
  parseFileChanges,
  parsePorcelainZ,
  resetBranchArgs,
  unsetUpstreamArgs
} from './git-process'
import { diffNameStatusCapture, diffPatchCapture } from './fixtures/git-diff-capture'

test('fetches a target branch with slashes fresh into its remote-tracking ref', () => {
  assert.deepEqual(fetchBranchArgs('/src/api', 'release/1.2'), [
    '-C', '/src/api', 'fetch', '--no-tags', 'origin', '+refs/heads/release/1.2:refs/remotes/origin/release/1.2'
  ])
})

test('moves the worktree branch to a full ref and drops its upstream', () => {
  assert.deepEqual(resetBranchArgs('/wt/review-api-7', 'refs/remotes/origin/merge-requests/7'), [
    '-C', '/wt/review-api-7', 'reset', '--hard', 'refs/remotes/origin/merge-requests/7', '--'
  ])
  assert.deepEqual(unsetUpstreamArgs('/wt/review-api-7'), ['-C', '/wt/review-api-7', 'branch', '--unset-upstream'])
})

test('reads `git status --porcelain -z`: one entry per change, a rename once, paths unquoted', () => {
  assert.deepEqual(parsePorcelainZ('R  new name.ts\0old name.ts\0?? .orca-review/\0 M "odd".ts\0'), [
    'R  new name.ts',
    '?? .orca-review/',
    ' M "odd".ts'
  ])
  assert.deepEqual(parsePorcelainZ(''), [])
})

test('asks git whether one commit is an ancestor of another', () => {
  assert.deepEqual(isAncestorArgs('/wt/review-api-7', 'aaa', 'bbb'), [
    '-C', '/wt/review-api-7', 'merge-base', '--is-ancestor', 'aaa', 'bbb'
  ])
})

test('diffs two commits with renames, once as a file list and once as zero-context hunks, for the given files only (#58)', () => {
  const common = [
    '--literal-pathspecs', '-C', '/wt/review-api-7', 'diff', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', '-M'
  ]
  assert.deepEqual(diffArgs('/wt/review-api-7', 'aaa', 'bbb', 'files', ['src/a.ts', 'odd*:name.ts']), [
    ...common, '--name-status', '-z', 'aaa', 'bbb', '--', 'src/a.ts', 'odd*:name.ts'
  ])
  assert.deepEqual(diffArgs('/wt/review-api-7', 'aaa', 'bbb', 'hunks', ['src/a.ts']), [
    ...common, '-U0', 'aaa', 'bbb', '--', 'src/a.ts'
  ])
})

test('pairs the file list with the patch by path, from real git output: type change, rename, quoted path (#58)', () => {
  assert.deepEqual(parseFileChanges(diffNameStatusCapture, diffPatchCapture), [
    { oldPath: 'del.ts', newPath: 'del.ts', hunks: [{ start: 5, count: 2 }] },
    // A file that became a symlink: two patch sections, wholly changed.
    { oldPath: 'link-me.txt', newPath: 'link-me.txt', hunks: 'all' },
    { oldPath: 'naïve "q".ts', newPath: 'naïve "q".ts', hunks: [{ start: 2, count: 1 }] },
    { oldPath: 'rename-me.ts', newPath: 'renamed.ts', hunks: [{ start: 4, count: 1 }] },
    { oldPath: 'z.ts', newPath: 'z.ts', hunks: [{ start: 2, count: 1 }] }
  ])
})

test('reads which lines of the older commit each changed file had touched (#58)', () => {
  const files = [
    'M', 'src/a b.ts', 'R087', 'src/old.ts', 'src/new.ts', 'R100', 'x.ts', 'y.ts', 'D', 'gone.ts', 'A', 'added.ts',
    'M', 'logo.png', ''
  ].join('\0')
  const patch = [
    'diff --git a/src/a b.ts b/src/a b.ts',
    'index 1..2 100644',
    '--- a/src/a b.ts',
    '+++ b/src/a b.ts',
    '@@ -3 +3 @@ function x() {',
    '-old',
    '+new',
    '@@ -10,0 +11,2 @@',
    '+added',
    '+@@ -99 +99 @@ not a hunk header: an added line',
    '@@ -20,4 +21 @@',
    '-a',
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 87%',
    'rename from src/old.ts',
    'rename to src/new.ts',
    '--- a/src/old.ts',
    '+++ b/src/new.ts',
    '@@ -7,2 +7,2 @@',
    'diff --git a/x.ts b/y.ts',
    'similarity index 100%',
    'rename from x.ts',
    'rename to y.ts',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    'diff --git a/added.ts b/added.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/added.ts',
    '@@ -0,0 +1 @@',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    ''
  ].join('\n')

  assert.deepEqual(parseFileChanges(files, patch), [
    {
      oldPath: 'src/a b.ts',
      newPath: 'src/a b.ts',
      hunks: [{ start: 3, count: 1 }, { start: 10, count: 0 }, { start: 20, count: 4 }]
    },
    { oldPath: 'src/old.ts', newPath: 'src/new.ts', hunks: [{ start: 7, count: 2 }] },
    { oldPath: 'x.ts', newPath: 'y.ts', hunks: [] },
    { oldPath: 'gone.ts', newPath: null, hunks: [{ start: 1, count: 3 }] },
    { oldPath: null, newPath: 'added.ts', hunks: [{ start: 0, count: 0 }] },
    { oldPath: 'logo.png', newPath: 'logo.png', hunks: 'all' }
  ])
  assert.deepEqual(parseFileChanges('', ''), [])
})
