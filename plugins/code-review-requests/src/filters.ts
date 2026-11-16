// The filter rules (#9, #26). Pure: the worker applies them on the client after every poll.
//   - Include paths (pathAllowlist) and Exclude paths (pathBlocklist) hold group or project paths.
//     A rule matches that path and everything below it; `*` stands for exactly one segment.
//   - Exclude authors (authorBlocklist) holds usernames, with an optional leading `@`.
//   - All matching is case-insensitive. Entries are separated by commas, spaces or new lines.
//     Invalid entries are ignored and reported, so the panel can warn about them.
// A Review Request is shown when the allowlist is empty or matches it, no blocklist rule matches
// it and its author is not blocked: the blocklist always wins. Filters never hide a Review Request
// that already has a Review Workspace (the `hasWorkspace` predicate).
import type { ReviewRequestView } from './protocol'
import type { Settings } from './settings'

export type FilterSettings = Pick<Settings, 'pathAllowlist' | 'pathBlocklist' | 'authorBlocklist'>

/** A path rule as lower-case segments; `*` matches any one segment. */
type PathRule = string[]

export type Filters = { allow: PathRule[]; block: PathRule[]; authors: Set<string> }

export type FilterResult = { visible: ReviewRequestView[]; hidden: ReviewRequestView[] }

const SEGMENT = /^(\*|[a-z0-9_.][a-z0-9_.-]*)$/
const USERNAME = /^[a-z0-9_.][a-z0-9_.-]*$/

function entriesOf(text: string): string[] {
  return text.split(/[\s,]+/).filter((entry) => entry !== '')
}

function pathRuleOf(entry: string): PathRule | null {
  const segments = entry.toLowerCase().replace(/^\/|\/$/g, '').split('/')
  return segments.every((segment) => SEGMENT.test(segment)) ? segments : null
}

function usernameOf(entry: string): string | null {
  const name = entry.toLowerCase().replace(/^@/, '')
  return USERNAME.test(name) ? name : null
}

/** What the three filter settings say, as one comparable value: a change re-polls (#26). */
export type FiltersKey = string & { readonly __brand: 'FiltersKey' }

export function filtersKeyOf(settings: FilterSettings): FiltersKey {
  return JSON.stringify([settings.pathAllowlist, settings.pathBlocklist, settings.authorBlocklist]) as FiltersKey
}

/** The rules in the three settings, and the entries that are not valid rules (in order). */
export function parseFilters(settings: FilterSettings): { filters: Filters; invalid: string[] } {
  const invalid: string[] = []
  function parse<T>(text: string, rule: (entry: string) => T | null): T[] {
    const rules: T[] = []
    for (const entry of entriesOf(text)) {
      const parsed = rule(entry)
      if (parsed === null) invalid.push(entry)
      else rules.push(parsed)
    }
    return rules
  }
  const allow = parse(settings.pathAllowlist, pathRuleOf)
  const block = parse(settings.pathBlocklist, pathRuleOf)
  const authors = new Set(parse(settings.authorBlocklist, usernameOf))
  return { filters: { allow, block, authors }, invalid }
}

function matches(rule: PathRule, path: string[]): boolean {
  return rule.length <= path.length && rule.every((segment, i) => segment === '*' || segment === path[i])
}

/** Whether the filters let this Review Request through, ignoring Review Workspaces. */
export function passesFilters(view: ReviewRequestView, filters: Filters): boolean {
  const path = view.projectPath.toLowerCase().split('/')
  if (filters.allow.length > 0 && !filters.allow.some((rule) => matches(rule, path))) return false
  if (filters.block.some((rule) => matches(rule, path))) return false
  return !filters.authors.has(view.author.toLowerCase())
}

/**
 * Splits a list into what is shown and what the filters hide, keeping the order. `hasWorkspace`
 * says whether a Review Request already has a Review Workspace; those are always shown.
 */
export function applyFilters(
  list: ReviewRequestView[],
  filters: Filters,
  hasWorkspace: (view: ReviewRequestView) => boolean = () => false
): FilterResult {
  const result: FilterResult = { visible: [], hidden: [] }
  for (const view of list) {
    const shown = hasWorkspace(view) || passesFilters(view, filters)
    ;(shown ? result.visible : result.hidden).push(view)
  }
  return result
}
