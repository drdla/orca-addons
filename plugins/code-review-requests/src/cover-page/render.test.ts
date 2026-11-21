// The Review Cover Page (#55): what a merge request's GitLab REST answers render to. The fixtures
// follow GitLab's documented shapes for GET …/merge_requests/:iid, …/diffs and …/approvals.
import { assert, test } from 'orca/testing'
import { renderCoverPage, type CoverPageSource, type RestApprovals, type RestDiff } from './render'

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

type SourceChanges = Partial<Omit<CoverPageSource, 'mr'>> & { mr?: Partial<CoverPageSource['mr']> }

function source(extra: SourceChanges = {}): CoverPageSource {
  const { mr, ...rest } = extra
  return {
    projectPath: 'acme/api',
    headSha: HEAD,
    linear: null,
    diffsTruncated: false,
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
      ...mr
    },
    diffs: [
      {
        old_path: 'src/login.ts',
        new_path: 'src/login.ts',
        new_file: false,
        renamed_file: false,
        deleted_file: false,
        diff: '@@ -1,3 +1,4 @@\n import x\n-const a = 1\n+const a = 2\n+const b = 3\n context\n'
      }
    ],
    approvals: { approvals_required: 2, approvals_left: 1, approved_by: [{ user: { username: 'bob', name: 'Bob' } }] },
    ...rest
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

test('the page records the checked-out commit, and says so when the merge request has moved on', () => {
  const checkedOut = '1111111111111111111111111111111111111111'
  const page = renderCoverPage(source({ headSha: checkedOut }))

  assert.ok(page.includes(`A snapshot of acme/api!7 at commit \`11111111\``), page)
  assert.ok(page.includes(`<!-- orca-review-cover-page head=${checkedOut} -->`), page)
  assert.ok(
    page.includes(
      `The merge request has moved on since this workspace was checked out (GitLab is at \`${HEAD.slice(0, 8)}\`): the changed-file list may be newer than the code.`
    ),
    page
  )
  assert.equal(renderCoverPage(source()).includes('moved on'), false)
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
    "Quoted: <img alt='single' src='/uploads/5e5e/single.png'>",
    'Elsewhere: ![badge](https://img.shields.io/badge/x.svg) stays an image.',
    'Absolute: ![abs](https://gitlab.example.com/acme/api/uploads/77/abs.png)',
    'New style: ![new](/-/project/42/uploads/88/new.png)',
    'Broken name: ![](/uploads/99/100%25%zz.png)',
    'By reference: ![diagram][d] and ![shortcut]',
    '',
    '[d]: /uploads/aa/diagram.png',
    '[shortcut]: /uploads/bb/shortcut.png "Shortcut"',
    '',
    'Code stays: `![x](/uploads/cc/x.png)`',
    '',
    '```md',
    '![fenced](/uploads/dd/fenced.png)',
    '```'
  ].join('\n')

  const page = renderCoverPage(source({ mr: { description } }))

  const base = 'https://gitlab.example.com/acme/api/uploads'
  assert.ok(page.includes(`Before: [Image: old screen](${base}/abc123/before.png)\n`), page)
  assert.ok(page.includes(`After: [Image: after fix.png](${base}/def456/after%20fix.png)\n`), page)
  assert.ok(page.includes(`Logs: [build.log](${base}/0a1b/build.log)\n`), page)
  assert.ok(page.includes(`Pasted: [Image: pasted](${base}/9f9f/pasted.png)\n`), page)
  assert.ok(page.includes(`Quoted: [Image: single](${base}/5e5e/single.png)\n`), page)
  assert.ok(page.includes('Elsewhere: ![badge](https://img.shields.io/badge/x.svg) stays an image.'), page)
  assert.ok(page.includes(`Absolute: [Image: abs](${base}/77/abs.png)\n`), page)
  assert.ok(page.includes('New style: [Image: new](https://gitlab.example.com/-/project/42/uploads/88/new.png)\n'), page)
  assert.ok(page.includes(`Broken name: [Image: 100%25%zz.png](${base}/99/100%25%zz.png)\n`), page)
  assert.ok(page.includes('By reference: [Image: diagram][d] and [Image: shortcut][shortcut]\n'), page)
  assert.ok(page.includes(`[d]: ${base}/aa/diagram.png\n`), page)
  assert.ok(page.includes(`[shortcut]: ${base}/bb/shortcut.png "Shortcut"\n`), page)
  assert.ok(page.includes('Code stays: `![x](/uploads/cc/x.png)`'), page)
  assert.ok(page.includes('```md\n![fenced](/uploads/dd/fenced.png)\n```'), page)
})

test('uploads resolve against a GitLab installed under a sub-path', () => {
  const page = renderCoverPage(
    source({
      mr: {
        web_url: 'https://example.com/gitlab/acme/api/-/merge_requests/7',
        description: '![a](/uploads/1/a.png) ![b](/-/project/42/uploads/2/b.png) ![c](/gitlab/-/project/42/uploads/3/c.png)'
      }
    })
  )
  assert.ok(
    page.includes(
      '[Image: a](https://example.com/gitlab/acme/api/uploads/1/a.png) ' +
        '[Image: b](https://example.com/gitlab/-/project/42/uploads/2/b.png) ' +
        '[Image: c](https://example.com/gitlab/-/project/42/uploads/3/c.png)'
    ),
    page
  )
})

test("the Linear ticket is the workspace's own link, else a Linear link in the description, else the branch name", () => {
  const description = 'Closes https://linear.app/acme/issue/OEO-123/add-login-form'
  const own = renderCoverPage(
    source({ linear: { identifier: 'OEO-9', url: 'https://linear.app/acme/issue/OEO-9/x' }, mr: { description } })
  )
  assert.ok(own.includes('| Linear ticket | [OEO-9](https://linear.app/acme/issue/OEO-9/x) |'), own)

  const linked = renderCoverPage(source({ mr: { source_branch: 'ada/oeo-12-login', description } }))
  assert.ok(linked.includes('| Linear ticket | [OEO-123](https://linear.app/acme/issue/OEO-123/add-login-form) |'), linked)

  for (const [branch, expected] of [
    ['ada/oeo-12-login', 'OEO-12'],
    ['oeo-12-login', 'OEO-12'],
    ['release-2026.11', 'none'],
    ['fix/utf-8-decoding', 'none'],
    ['fix/sha-256-hashes', 'none'],
    ['feature-abc-12', 'none']
  ] as const) {
    const page = renderCoverPage(source({ mr: { source_branch: branch } }))
    assert.ok(page.includes(`| Linear ticket | ${expected} |`), `${branch}: ${page}`)
  }
})

test('approvals count who approved, out of the required number when GitLab requires any', () => {
  const approver = (name: string) => ({ user: { username: name.toLowerCase(), name } })
  const cases: [RestApprovals | null, string][] = [
    [{ approvals_required: 2, approvals_left: 0, approved_by: [approver('Bob'), approver('Cy'), approver('Di')] }, '3 of 2 (Bob, Cy, Di)'],
    [{ approvals_required: 0, approvals_left: 0, approved_by: [approver('Bob')] }, '1 (Bob)'],
    [{ approved_by: [approver('Bob')] }, '1 (Bob)'],
    [{ approvals_required: 0, approvals_left: 0, approved_by: [] }, 'none'],
    [{ approvals_required: 1, approvals_left: 1, approved_by: [] }, '0 of 1'],
    [null, 'unknown']
  ]
  for (const [approvals, expected] of cases) {
    const page = renderCoverPage(source({ approvals }))
    assert.ok(page.includes(`| Approvals | ${expected} |`), `${expected}: ${page}`)
  }
})

test('metadata without labels or pipeline says so', () => {
  const page = renderCoverPage(source({ mr: { labels: [], head_pipeline: null } }))
  assert.ok(page.includes('| Labels | none |'), page)
  assert.ok(page.includes('| Pipeline | none |'), page)
  const failed = renderCoverPage(source({ mr: { head_pipeline: { status: 'failed' } } }))
  assert.ok(failed.includes('| Pipeline | failed |'), failed)
})

test('Markdown in the title, author, labels and paths is escaped', () => {
  const page = renderCoverPage(
    source({
      mr: {
        title: 'Fix *all* the <b>bugs</b> in [core] #1',
        author: { username: 'ada_l', name: 'Ada_Love*' },
        labels: ['needs_review', 'a|b'],
        source_branch: 'feat/`tick`'
      },
      diffs: [diff('docs/``odd``.md', { diff: '@@ -1 +1 @@\n+x\n' })]
    })
  )
  assert.ok(page.startsWith('# Fix \\*all\\* the \\<b\\>bugs\\</b\\> in \\[core\\] \\#1\n'), page)
  assert.ok(page.includes(') by Ada\\_Love\\* (@ada\\_l)\n'), page)
  assert.ok(page.includes('| Labels | needs\\_review, a\\|b |'), page)
  assert.ok(page.includes('| Branches | `` feat/`tick` `` → `main` |'), page)
  assert.ok(page.includes('| ``` docs/``odd``.md ``` | modified | +1 | -0 |'), page)
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
        diff('src/empty.ts', { new_file: true }),
        diff('src/was-empty.ts', { deleted_file: true }),
        diff('assets/huge.json', { too_large: true }),
        diff('assets/icon.png', { new_file: true, diff: 'Binary files /dev/null and b/assets/icon.png differ\n' }),
        diff('assets/logo.png')
      ]
    })
  )

  assert.ok(
    page.includes(
      [
        '## Changed files (9)',
        '',
        'To step through the diffs, open Source Control → "Committed on Branch".',
        '',
        '| File | Change | Added | Removed |',
        '| --- | --- | --- | --- |',
        '| `src/new.ts` | added | +2 | -0 |',
        '| `src/gone.ts` | deleted | +0 | -3 |',
        '| `src/old-name.ts` → `src/new-name.ts` | renamed | +0 | -0 |',
        '| `src/moved.ts` → `lib/moved.ts` | renamed | +1 | -1 |',
        '| `src/empty.ts` | added | +0 | -0 |',
        '| `src/was-empty.ts` | deleted | +0 | -0 |',
        '| `assets/huge.json` | modified | ? | ? |',
        '| `assets/icon.png` | added | ? | ? |',
        '| `assets/logo.png` | modified | ? | ? |',
        ''
      ].join('\n')
    ),
    page
  )
  assert.equal(/\]\(/.test(page.split('## Changed files')[1]!.split('---\n')[0]!), false)
})

test('a changed-file list cut short by the page limit says so', () => {
  const page = renderCoverPage(source({ diffsTruncated: true }))
  assert.ok(page.includes('## Changed files (1 shown)'), page)
  assert.ok(page.includes('The list is cut short: GitLab has more changed files than the page shows.'), page)
})
