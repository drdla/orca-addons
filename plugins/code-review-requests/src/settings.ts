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
  /** Path rules, one per line or comma-separated (#26). */
  pathAllowlist: '',
  pathBlocklist: '',
  /** Usernames, one per line or comma-separated (#26). */
  authorBlocklist: '',
  /** The Orca agent id an Agent Review runs (#27). */
  reviewAgent: 'claude',
  /** The Review Prompt (#27). Placeholders are defined by #27. */
  reviewPrompt:
    'Review the GitLab merge request {url} ("{title}"). Write your findings to .orca-review/findings.json.',
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
