import { assert, test } from 'orca/testing'
import type { ReviewRequestView } from '../protocol'
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

test('the default Review Prompt names the MR and where the findings go', () => {
  const prompt = reviewPromptFor(DEFAULT_SETTINGS.reviewPrompt, RR)
  assert.match(prompt, /merge_requests\/7/)
  assert.match(prompt, /\.orca-review\/findings\.json/)
  assert.equal(/\{\w+\}/.test(prompt), false)
})

test('the custom command gets the prompt as one shell word, quotes included', () => {
  assert.equal(
    reviewCommandFor('claude --model opus {prompt}', "Don't stop", RR),
    `claude --model opus 'Don'\\''t stop'`
  )
  assert.equal(reviewCommandFor('review.sh {mrUrl}', 'x', RR), `review.sh '${RR.url}'`)
})
