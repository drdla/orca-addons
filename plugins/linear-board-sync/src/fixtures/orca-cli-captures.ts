// Sanitized captures of the `orca` CLI's JSON (Orca 1.4.261), trimmed to a few rows; field names
// and nesting are as the CLI printed them. The adapter tests parse these, so a CLI shape change
// shows up here first.

export const worktreeListEnvelope = {
  id: 'e1',
  ok: true,
  result: {
    worktrees: [
      {
        id: 'repo-1::/Users/me/GitLab/webapps',
        repoId: 'repo-1',
        projectId: 'git:gitlab.com/acme/webapps',
        path: '/Users/me/GitLab/webapps',
        branch: 'refs/heads/dev',
        isMainWorktree: true,
        isArchived: false,
        displayName: 'Default workspace',
        linkedLinearIssue: null,
        linkedLinearIssueWorkspaceId: null,
        linkedLinearIssueOrganizationUrlKey: null,
        workspaceStatus: 'in-progress',
        linkedItems: []
      },
      {
        id: 'repo-1::/Users/me/orca/workspaces/webapps/oeo-1577-add-toggle',
        repoId: 'repo-1',
        projectId: 'git:gitlab.com/acme/webapps',
        path: '/Users/me/orca/workspaces/webapps/oeo-1577-add-toggle',
        branch: 'refs/heads/oeo-1577-add-toggle',
        isMainWorktree: false,
        isArchived: false,
        displayName: 'oeo-1577-add-toggle',
        linkedLinearIssue: 'OEO-1577',
        linkedLinearIssueWorkspaceId: 'ws-v',
        linkedLinearIssueOrganizationUrlKey: 'vestigas',
        workspaceStatus: 'in-review',
        linkedItems: [{ provider: 'linear', type: 'issue', url: 'https://linear.app/vestigas/issue/OEO-1577/add-toggle' }]
      }
    ],
    hostScope: {},
    totalCount: 2,
    truncated: false
  },
  _meta: { runtimeId: 'r1' }
}

export const teamListEnvelope = {
  id: 'e2',
  ok: true,
  result: {
    teams: [
      {
        id: 't-cor',
        name: 'Core',
        key: 'COR',
        url: 'https://linear.app/vestigas/team/COR/all',
        workspace: { id: 'ws-v', name: 'Vestigas GmbH' }
      },
      {
        id: 't-oeo',
        name: 'Orders, ESG, Onboarding, Self-Service',
        key: 'OEO',
        url: 'https://linear.app/vestigas/team/OEO/all',
        workspace: { id: 'ws-v', name: 'Vestigas GmbH' }
      }
    ]
  }
}

export const issueEnvelope = {
  id: 'e3',
  ok: true,
  result: {
    issue: {
      id: 'i-1577',
      identifier: 'OEO-1577',
      title: 'Add toggle',
      url: 'https://linear.app/vestigas/issue/OEO-1577/add-toggle',
      description: '…',
      state: { name: 'Review', type: 'started', color: '#75d9a7', id: 's-review' },
      team: { id: 't-oeo', name: 'Orders, ESG, Onboarding, Self-Service', key: 'OEO', color: '#eb5757' },
      project: null,
      cycle: { id: 'c1', name: null },
      assignee: { id: 'u1', displayName: 'me', avatarUrl: 'https://example.invalid/a.png' },
      labels: [],
      priority: 3,
      priorityLabel: 'medium',
      estimate: 3,
      dueDate: null,
      branchName: 'oeo-1577-add-toggle',
      createdAt: '2026-10-27T11:41:37.799Z',
      updatedAt: '2026-11-17T17:22:08.278Z'
    },
    meta: {},
    inlineMedia: []
  }
}

/** What `orca linear issue` prints for an identifier Linear doesn't know. */
export const issueNotFoundEnvelope = {
  id: 'e4',
  ok: false,
  error: { code: 'linear_network_error', message: 'Entity not found: Issue - Could not find referenced Issue.' },
  _meta: { runtimeId: 'r1' }
}
