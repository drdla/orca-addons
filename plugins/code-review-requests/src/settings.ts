// The plugin's settings and their defaults, in one table. Orca applies the manifest's
// `contributes.settings` defaults, but the test kit and `orca plugin check` do not, so code
// always reads through readSettings(). settings.test.ts keeps this table and the manifest equal.

export const DEFAULT_SETTINGS = {
  /** The GitLab instance (#8): the single source of truth for the host. */
  instanceUrl: 'https://gitlab.com',
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
