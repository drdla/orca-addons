// The Review Prompt and the custom review command (#6): placeholders filled from the Review
// Request. Unknown placeholders are left as written.
import type { ReviewRequestView } from '../protocol'

/** The placeholders the Review Prompt and the custom command support. */
export const PROMPT_PLACEHOLDERS = [
  'mrUrl',
  'title',
  'project',
  'sourceBranch',
  'targetBranch',
  'baseRef',
  'author'
] as const

function valuesOf(rr: ReviewRequestView): Record<string, string> {
  return {
    mrUrl: rr.url,
    title: rr.title,
    project: rr.projectPath,
    sourceBranch: rr.sourceBranch ?? '',
    targetBranch: rr.targetBranch ?? '',
    // The Review Workspace's base (#54, #56): the fetched target branch, so `git diff
    // {baseRef}...HEAD` is the merge request's diff.
    baseRef: rr.targetBranch ? `origin/${rr.targetBranch}` : '',
    author: rr.author
  }
}

function fill(template: string, values: Record<string, string>, quote: (value: string) => string): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? quote(values[name]!) : whole
  )
}

export function reviewPromptFor(template: string, rr: ReviewRequestView): string {
  return fill(template, valuesOf(rr), (value) => value)
}

/**
 * The custom command line: `{prompt}` and the other placeholders become single-quoted shell words,
 * so `claude --model opus {prompt}` runs claude with the whole prompt as one argument.
 */
export function reviewCommandFor(template: string, prompt: string, rr: ReviewRequestView): string {
  return fill(template, { ...valuesOf(rr), prompt }, shellQuote)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
