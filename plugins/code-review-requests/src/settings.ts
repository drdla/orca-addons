// The plugin's settings and their defaults, in one table. Orca applies the manifest's
// `contributes.settings` defaults, but the test kit and `orca plugin check` do not, so code
// always reads through readSettings(). settings.test.ts keeps this table and the manifest equal.

export const DEFAULT_SETTINGS = {
  /** The GitLab instance (#8): the single source of truth for the host. */
  instanceUrl: 'https://gitlab.com',
  /** The glab binary (#8); blank probes PATH and the usual install folders. */
  glabPath: '',
  /** Poll interval in minutes (#21). */
  pollMinutes: 5,
  /** A Review Request waiting longer than this, in working hours Mon–Fri, is Overdue (#22). */
  overdueHours: 24,
  /** Path rules, separated by commas, spaces or new lines (src/filters.ts, #26). */
  pathAllowlist: '',
  pathBlocklist: '',
  /** Usernames, separated by commas, spaces or new lines (#26). */
  authorBlocklist: '',
  /** The Orca agent id an Agent Review runs (#27). */
  reviewAgent: 'claude',
  /**
   * The Review Prompt (#27). Placeholders: {mrUrl}, {title}, {project}, {sourceBranch},
   * {targetBranch}, {author} (workspaces/review-prompt.ts). The findings.json format it asks for is
   * the import's contract (review-draft/findings.ts, #29).
   */
  reviewPrompt:
    "Review the GitLab merge request {mrUrl} (\"{title}\" by {author}, {sourceBranch} into {targetBranch}) in {project}. The workspace has the MR's changes checked out. Don't post anything to GitLab. Write your findings to .orca-review/findings.json as JSON like `{\"headSha\": \"<output of git rev-parse HEAD>\", \"findings\": [{\"path\": \"src/file.ts\", \"line\": 42, \"body\": \"What is wrong and how to fix it.\"}, {\"body\": \"A comment on the merge request as a whole.\"}]}`. \"line\" is the line in the new version of the file; add \"startLine\" for a range of lines.",
  /** Optional custom command that replaces the agent launch (#27). */
  reviewCommand: '',
  /** Days after a Review Request ends before its Review Workspace is removed; 0 turns it off (#28). */
  autoRemoveDays: 2
}

export type Settings = { [K in keyof typeof DEFAULT_SETTINGS]: (typeof DEFAULT_SETTINGS)[K] }

/** How the panel's Settings view edits a setting. */
export type SettingControl = 'text' | 'multiline' | 'integer'

/** One setting as the panel's Settings view shows it: the manifest's words and limits. */
export type SettingField = {
  key: keyof Settings
  title: string
  description?: string
  placeholder?: string
  control: SettingControl
  minimum?: number
  maximum?: number
}

/**
 * The manifest's `contributes.settings`, for the panel's Settings view (the plugin API can't read
 * a setting's title or description, so they are repeated here). settings.test.ts keeps this list
 * and the manifest equal, in the same order.
 */
export const SETTING_FIELDS: readonly SettingField[] = [
  {
    key: 'instanceUrl',
    title: 'GitLab instance URL',
    description:
      'The GitLab instance to read Review Requests from, for example https://gitlab.com or https://gitlab.example.com.',
    placeholder: 'https://gitlab.com',
    control: 'text'
  },
  {
    key: 'glabPath',
    title: 'glab path',
    description:
      'The full path of the glab command, for example /opt/homebrew/bin/glab. Blank looks for it on PATH and in the usual install folders (/opt/homebrew/bin, /usr/local/bin, ~/.local/bin).',
    placeholder: '/opt/homebrew/bin/glab',
    control: 'text'
  },
  { key: 'pollMinutes', title: 'Refresh every (minutes)', control: 'integer', minimum: 1, maximum: 1440 },
  {
    key: 'overdueHours',
    title: 'Overdue after (working hours)',
    description: 'A Review Request waiting longer than this, counting Monday to Friday only, is marked overdue.',
    control: 'integer',
    minimum: 1
  },
  {
    key: 'pathAllowlist',
    title: 'Only these groups or projects',
    description:
      'Group or project paths, separated by commas, spaces or new lines, for example acme/backend or acme/*/api (* is one path segment). A path matches itself and everything below it; case does not matter. Empty means all.',
    control: 'multiline'
  },
  {
    key: 'pathBlocklist',
    title: 'Never these groups or projects',
    description:
      'Group or project paths, written like the allowlist. A Review Request matching one is hidden, even if the allowlist matches it, unless it already has a review workspace.',
    control: 'multiline'
  },
  {
    key: 'authorBlocklist',
    title: 'Never these authors',
    description: 'GitLab usernames, separated by commas, spaces or new lines, for example renovate-bot or @dependabot.',
    control: 'multiline'
  },
  {
    key: 'reviewAgent',
    title: 'Review agent',
    description: 'The Orca agent that runs an Agent Review, for example claude or codex.',
    control: 'text'
  },
  {
    key: 'reviewPrompt',
    title: 'Review Prompt',
    description:
      'The prompt that starts an Agent Review. Placeholders: {mrUrl}, {title}, {project}, {sourceBranch}, {targetBranch}, {author}.',
    control: 'multiline'
  },
  {
    key: 'reviewCommand',
    title: 'Custom review command',
    description:
      'Optional. A command to run in the review workspace instead of launching the review agent, for example claude --model opus {prompt}. {prompt} is the filled Review Prompt; the Review Prompt\'s placeholders work too.',
    control: 'text'
  },
  {
    key: 'autoRemoveDays',
    title: 'Remove ended review workspaces after (days)',
    description: 'Clean workspaces of Ended Review Requests are removed after this many days. 0 turns it off.',
    control: 'integer',
    minimum: 0
  }
]

/** What a field's typed text saves as, or why it can't be saved (Orca refuses wrong types). */
export function parseSettingInput(field: SettingField, text: string): { value: string | number } | { error: string } {
  if (field.control !== 'integer') return { value: text }
  const trimmed = text.trim()
  const value = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
  const tooLow = field.minimum !== undefined && value < field.minimum
  const tooHigh = field.maximum !== undefined && value > field.maximum
  if (Number.isInteger(value) && !tooLow && !tooHigh) return { value }
  if (field.minimum !== undefined && field.maximum !== undefined) {
    return { error: `Enter a whole number from ${field.minimum} to ${field.maximum}.` }
  }
  if (field.minimum !== undefined) return { error: `Enter a whole number, ${field.minimum} or more.` }
  return { error: 'Enter a whole number.' }
}

type SettingsSource = { get(): Promise<Record<string, unknown>> }

/** All settings, each falling back to its default when unset or of the wrong type. */
export async function readSettings(source: SettingsSource): Promise<Settings> {
  const stored = await source.get()
  const result = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const value = stored[key]
    if (typeof value === typeof fallback) result[key] = value
  }
  return result as Settings
}
