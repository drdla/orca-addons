import { assert, test } from 'orca/testing'
import type { ReviewRequestView } from '../protocol'
import { parseFindings } from '../review-draft/findings'
import { DEFAULT_SETTINGS } from '../settings'
import { reviewCommandFor, reviewPromptFor } from './review-prompt'

const RR: ReviewRequestView = {
  url: 'https://gitlab.example.com/acme/api/-/merge_requests/7',
  title: "Don't break login",
  projectPath: 'acme/api',
  iid: 7,
  author: 'ada',
  requestedAt: 0,
  sourceBranch: 'feature/login',
  targetBranch: 'main'
}

test('fills every placeholder of the Review Prompt and leaves unknown ones alone', () => {
  const prompt = reviewPromptFor(
    'Review {mrUrl} "{title}" in {project}: {sourceBranch} into {targetBranch} by {author}. {other}',
    RR
  )
  assert.equal(
    prompt,
    `Review https://gitlab.example.com/acme/api/-/merge_requests/7 "Don't break login" in acme/api: feature/login into main by ada. {other}`
  )
})

test("{baseRef} is the Review Workspace's base, the fetched target branch", () => {
  assert.equal(reviewPromptFor('git diff {baseRef}...HEAD', RR), 'git diff origin/main...HEAD')
  assert.equal(
    reviewCommandFor('review.sh {baseRef} {prompt}', 'x', { ...RR, targetBranch: "it's" }),
    `review.sh 'origin/it'\\''s' 'x'`
  )
})

test('the default Review Prompt names the MR and where the findings go', () => {
  const prompt = reviewPromptFor(DEFAULT_SETTINGS.reviewPrompt, RR)
  assert.match(prompt, /merge_requests\/7/)
  assert.match(prompt, /\.orca-review\/findings\.json/)
  assert.equal(/\{\w+\}/.test(prompt), false)
})

test('the default Review Prompt points to the Review Cover Page and gives the exact diff command (#56)', () => {
  const prompt = reviewPromptFor(DEFAULT_SETTINGS.reviewPrompt, RR)
  assert.ok(prompt.includes('.orca-review/merge-request.md'), prompt)
  assert.ok(prompt.includes('`git diff origin/main...HEAD`'), prompt)
})

test('the default Review Prompt shows a findings.json example the import accepts (#29)', () => {
  const example = /`(\{.*\})`/.exec(DEFAULT_SETTINGS.reviewPrompt)?.[1]
  assert.ok(example, 'the prompt quotes an example in backticks')
  const parsed = parseFindings(example!)
  assert.deepEqual(parsed.warnings, [])
  assert.ok(parsed.headSha !== null)
  assert.deepEqual(
    parsed.findings.map((f) => f.filePath === null),
    [false, true],
    'one line finding and one general one'
  )
})

test('the custom command gets the prompt as one shell word, quotes included', () => {
  assert.equal(
    reviewCommandFor('claude --model opus {prompt}', "Don't stop", RR),
    `claude --model opus 'Don'\\''t stop'`
  )
  assert.equal(reviewCommandFor('review.sh {mrUrl}', 'x', RR), `review.sh '${RR.url}'`)
})
