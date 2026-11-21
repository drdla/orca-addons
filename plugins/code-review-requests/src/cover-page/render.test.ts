// The review cover page (#55): what a merge request's GitLab REST answers render to. The fixtures
// follow GitLab's documented shapes for GET …/merge_requests/:iid, …/diffs and …/approvals.
import { assert, test } from 'orca/testing'
import { renderCoverPage, type CoverPageSource, type RestDiff } from './render'

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

function source(extra: { mr?: Partial<CoverPageSource['mr']>; diffs?: RestDiff[]; approvals?: CoverPageSource['approvals'] } = {}): CoverPageSource {
  return {
    mr: {
      iid: 7,
      title: 'Add login',
      description: 'Adds a login form.\n\nSee the design doc.',
      web_url: 'https://gitlab.example.com/acme/api/-/merge_requests/7',
      author: { username: 'ada', name: 'Ada Lovelace' },
      source_branch: 'feature/login',
      target_branch: 'main',
      labels: ['backend', 'security'],
      sha: HEAD,
      head_pipeline: { status: 'success' },
      references: { full: 'acme/api!7' },
      ...extra.mr
    },
    diffs: extra.diffs ?? [
      {
        old_path: 'src/login.ts',
        new_path: 'src/login.ts',
        new_file: false,
        renamed_file: false,
        deleted_file: false,
        diff: '@@ -1,3 +1,4 @@\n import x\n-const a = 1\n+const a = 2\n+const b = 3\n context\n'
      }
    ],
    approvals: extra.approvals === undefined
      ? { approvals_required: 2, approvals_left: 1, approved_by: [{ user: { username: 'bob', name: 'Bob' } }] }
      : extra.approvals
  }
}

test('a merge request renders its title, metadata, description, changed files and head commit', () => {
  assert.equal(
    renderCoverPage(source()),
    [
      '# Add login',
      '',
      '[acme/api!7](https://gitlab.example.com/acme/api/-/merge_requests/7) by Ada Lovelace (@ada)',
      '',
      '| | |',
      '| --- | --- |',
      '| Branches | `feature/login` → `main` |',
      '| Labels | backend, security |',
      '| Linear ticket | none |',
      '| Pipeline | passed |',
      '| Approvals | 1 of 2 (Bob) |',
      '',
      '## Description',
      '',
      'Adds a login form.',
      '',
      'See the design doc.',
      '',
      '## Changed files (1)',
      '',
      'To step through the diffs, open Source Control → "Committed on Branch".',
      '',
      '| File | Change | Added | Removed |',
      '| --- | --- | --- | --- |',
      '| `src/login.ts` | modified | +2 | -1 |',
      '',
      '---',
      '',
      `A snapshot of acme/api!7 at commit \`${HEAD.slice(0, 8)}\`: it doesn't change when the merge request does.`,
      '',
      `<!-- orca-review-cover-page head=${HEAD} -->`,
      ''
    ].join('\n')
  )
})

test('an empty description says so instead of leaving the section blank', () => {
  for (const description of [null, '', '  \n ']) {
    const page = renderCoverPage(source({ mr: { description } }))
    assert.match(page, /## Description\n\n_No description\._\n\n## Changed files/)
  }
})

test('uploads in the description become links to GitLab, images shown as links rather than inline', () => {
  const description = [
    'Before: ![old screen](/uploads/abc123/before.png){width=600 height=400}',
    'After: ![](/uploads/def456/after%20fix.png "after")',
    'Logs: [build.log](/uploads/0a1b/build.log)',
    'Pasted: <img src="/uploads/9f9f/pasted.png" alt="pasted" width="300">',
    'Elsewhere: ![badge](https://img.shields.io/badge/x.svg) stays an image.',
    'Absolute: ![abs](https://gitlab.example.com/acme/api/uploads/77/abs.png)'
  ].join('\n')

  const page = renderCoverPage(source({ mr: { description } }))

  const base = 'https://gitlab.example.com/acme/api/uploads'
  assert.ok(page.includes(`Before: [Image: old screen](${base}/abc123/before.png)\n`), page)
  assert.ok(page.includes(`After: [Image: after fix.png](${base}/def456/after%20fix.png)\n`), page)
  assert.ok(page.includes(`Logs: [build.log](${base}/0a1b/build.log)\n`), page)
  assert.ok(page.includes(`Pasted: [Image: pasted](${base}/9f9f/pasted.png)\n`), page)
  assert.ok(page.includes('Elsewhere: ![badge](https://img.shields.io/badge/x.svg) stays an image.'), page)
  assert.ok(page.includes(`Absolute: [Image: abs](${base}/77/abs.png)\n`), page)
})

test('the linked Linear ticket comes from a Linear link in the description, else the branch name', () => {
  const linked = renderCoverPage(
    source({
      mr: {
        source_branch: 'ada/oeo-12-login',
        description: 'Closes https://linear.app/acme/issue/OEO-123/add-login-form'
      }
    })
  )
  assert.ok(linked.includes('| Linear ticket | [OEO-123](https://linear.app/acme/issue/OEO-123/add-login-form) |'), linked)

  const fromBranch = renderCoverPage(source({ mr: { source_branch: 'ada/oeo-12-login' } }))
  assert.ok(fromBranch.includes('| Linear ticket | OEO-12 |'), fromBranch)

  const none = renderCoverPage(source({ mr: { source_branch: 'release-2026.11' } }))
  assert.ok(none.includes('| Linear ticket | none |'), none)
})

test('metadata without labels, pipeline or approvals says so', () => {
  const page = renderCoverPage(source({ mr: { labels: [], head_pipeline: null }, approvals: null }))
  assert.ok(page.includes('| Labels | none |'), page)
  assert.ok(page.includes('| Pipeline | none |'), page)
  assert.ok(page.includes('| Approvals | unknown |'), page)

  const failed = renderCoverPage(
    source({ mr: { head_pipeline: { status: 'failed' } }, approvals: { approvals_required: 0, approvals_left: 0, approved_by: [] } })
  )
  assert.ok(failed.includes('| Pipeline | failed |'), failed)
  assert.ok(failed.includes('| Approvals | none required |'), failed)
})

function diff(path: string, extra: Partial<RestDiff> = {}): RestDiff {
  return { old_path: path, new_path: path, new_file: false, renamed_file: false, deleted_file: false, diff: '', ...extra }
}

test('the changed-file list gives each file its change, added and removed lines, without links', () => {
  const page = renderCoverPage(
    source({
      diffs: [
        diff('src/new.ts', { new_file: true, diff: '@@ -0,0 +1,2 @@\n+one\n+two\n' }),
        diff('src/gone.ts', { deleted_file: true, diff: '@@ -1,3 +0,0 @@\n-a\n-b\n--- not a header\n' }),
        diff('src/old-name.ts', { new_path: 'src/new-name.ts', renamed_file: true }),
        diff('src/moved.ts', { new_path: 'lib/moved.ts', renamed_file: true, diff: '@@ -1 +1 @@\n-x\n+y\n\\ No newline at end of file\n' }),
        diff('assets/huge.json', { too_large: true }),
        diff('assets/logo.png')
      ]
    })
  )

  assert.ok(
    page.includes(
      [
        '## Changed files (6)',
        '',
        'To step through the diffs, open Source Control → "Committed on Branch".',
        '',
        '| File | Change | Added | Removed |',
        '| --- | --- | --- | --- |',
        '| `src/new.ts` | added | +2 | -0 |',
        '| `src/gone.ts` | deleted | +0 | -3 |',
        '| `src/old-name.ts` → `src/new-name.ts` | renamed | +0 | -0 |',
        '| `src/moved.ts` → `lib/moved.ts` | renamed | +1 | -1 |',
        '| `assets/huge.json` | modified | ? | ? |',
        '| `assets/logo.png` | modified | ? | ? |',
        ''
      ].join('\n')
    ),
    page
  )
  assert.equal(/\]\(/.test(page.split('## Changed files')[1]!.split('---\n')[0]!), false)
})
