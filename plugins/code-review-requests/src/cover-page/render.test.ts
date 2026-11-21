// The Review Cover Page (#55): what a merge request's GitLab REST answers render to. The fixtures
// follow GitLab's documented shapes for GET …/merge_requests/:iid and …/diffs.
import { assert, test } from 'orca/testing'
import { renderCoverPage, withUpdatedCallout, type CoverPageSource, type RestDiff } from './render'

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

type SourceChanges = Partial<Omit<CoverPageSource, 'mr'>> & { mr?: Partial<CoverPageSource['mr']> }

function source(extra: SourceChanges = {}): CoverPageSource {
  const { mr, ...rest } = extra
  return {
    projectPath: 'acme/api',
    headSha: HEAD,
    diffsTruncated: false,
    mr: {
      iid: 7,
      title: 'Add login',
      description: 'Adds a login form.\n\nSee the design doc.',
      web_url: 'https://gitlab.example.com/acme/api/-/merge_requests/7',
      sha: HEAD,
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
    ...rest
  }
}

test('a merge request renders its title, description, changed files and head commit', () => {
  assert.equal(
    renderCoverPage(source()),
    [
      '# Add login',
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

test('the page records the checked-out commit, and opens with a callout when the merge request has moved on', () => {
  const checkedOut = '1111111111111111111111111111111111111111'
  const page = renderCoverPage(source({ headSha: checkedOut }))

  assert.ok(page.includes(`A snapshot of acme/api!7 at commit \`11111111\``), page)
  assert.ok(page.includes(`<!-- orca-review-cover-page head=${checkedOut} -->`), page)
  assert.ok(page.startsWith(`# Add login\n\n${UPDATED_CALLOUT}\n\nAdds a login form.`), page)
  assert.equal(renderCoverPage(source()).includes('Merge request updated'), false)
})

const UPDATED_CALLOUT =
  `> **Merge request updated.** New commits were pushed since this workspace was checked out: GitLab is at \`${HEAD.slice(0, 8)}\`, ` +
  'the workspace and this page at `11111111`. Use "Update workspace" on its card in the Review Requests panel to review them.'

test('an existing page gains the callout once the merge request moves on, and loses it when it is back in step', () => {
  const checkedOut = '1111111111111111111111111111111111111111'
  const page = renderCoverPage(source({ headSha: checkedOut, mr: { ...source().mr, sha: checkedOut } }))
  assert.equal(page.includes('Merge request updated'), false)

  const behind = withUpdatedCallout(page, HEAD)
  assert.ok(behind.startsWith(`# Add login\n\n${UPDATED_CALLOUT}\n\nAdds a login form.`), behind)
  assert.equal(withUpdatedCallout(behind, HEAD), behind)
  assert.equal(withUpdatedCallout(behind, checkedOut), page)
  assert.equal(withUpdatedCallout('# A page from elsewhere\n', HEAD), '# A page from elsewhere\n')
})

test('an empty description says so instead of leaving the section blank', () => {
  for (const description of [null, '', '  \n ']) {
    const page = renderCoverPage(source({ mr: { description } }))
    assert.match(page, /^# Add login\n\n_No description\._\n\n## Changed files/)
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

test('Markdown in the title and paths is escaped', () => {
  const page = renderCoverPage(
    source({
      mr: {
        title: 'Fix *all* the <b>bugs</b> in [core] #1'
      },
      diffs: [diff('docs/``odd``.md', { diff: '@@ -1 +1 @@\n+x\n' })]
    })
  )
  assert.ok(page.startsWith('# Fix \\*all\\* the \\<b\\>bugs\\</b\\> in \\[core\\] \\#1\n'), page)
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
