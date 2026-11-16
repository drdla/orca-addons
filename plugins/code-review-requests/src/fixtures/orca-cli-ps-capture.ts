// GENERATED from a real capture on 2026-11-16 (#10), then sanitized like orca-cli-captures.ts:
// names, ids, paths, prompts and messages are placeholders; key sets, enums, booleans and counts
// are real. Captured with Orca 1.4.259: `orca worktree ps --json --limit 1`.

export const worktreePsEnvelope = {
  id: '00000000-0000-4000-8000-000000000011',
  ok: true,
  result: {
    worktrees: [
      {
        workspaceKind: 'git',
        worktreeId: '00000000-0000-4000-8000-000000000002::/Users/me/orca/workspaces/service/review-sync',
        repoId: '00000000-0000-4000-8000-000000000002',
        hostId: 'local',
        identity: {
          key: 'wt2:local:00000000-0000-4000-8000-000000000004',
          executionHostId: 'local',
          instanceId: '00000000-0000-4000-8000-000000000004'
        },
        terminalPlatform: 'darwin',
        repo: 'service',
        path: '/Users/me/orca/workspaces/service/review-sync',
        branch: 'feature/workspace-2',
        isArchived: false,
        isMainWorktree: false,
        hasHostSidebarActivity: true,
        defaultBranch: false,
        worktreeInstanceId: '00000000-0000-4000-8000-000000000004',
        parentWorktreeId: null,
        childWorktreeIds: [],
        workspaceLineage: null,
        displayName: 'Review the sync job',
        workspaceStatus: 'in-progress',
        sortOrder: 1794840217895,
        lastActivityAt: 1794843673970,
        linkedIssue: null,
        linkedPR: null,
        linkedLinearIssue: null,
        linkedGitLabMR: null,
        linkedGitLabIssue: null,
        linkedItems: [],
        comment: '',
        isPinned: false,
        isActive: true,
        unread: false,
        liveTerminalCount: 2,
        hasAttachedPty: true,
        unverifiableTerminalCount: 0,
        lastOutputAt: 1794849451038,
        preview: 'Reviewing the diff',
        status: 'working',
        agents: [
          {
            paneKey: 'pane-1',
            orcaSessionId: '00000000-0000-4000-8000-000000000012',
            parentPaneKey: null,
            state: 'working',
            workingMode: 'monitoring',
            agentType: 'claude',
            prompt: 'Review the merge request',
            taskTitle: null,
            displayName: null,
            conversationName: 'Review',
            lastAssistantMessage: 'Looking at the changes.',
            toolName: 'Bash',
            toolInput: 'ls',
            interrupted: false,
            mainAgent: { state: 'done', stateStartedAt: 1794843713674 },
            stateStartedAt: 1794843002584,
            updatedAt: 1794843895375,
            hasLivePty: true,
            programStatus: { state: 'done', observedAt: 1794843713693 },
            activity: {
              listed: true,
              status: 'unverifiable',
              unread: false,
              clearable: false,
              sortAt: 1794843002584,
              title: 'Review'
            }
          }
        ],
        sidebarStatus: 'working',
        terminalVerdict: 'live',
        environment: { id: 'local', name: 'local' },
        parent: null,
        address: { environment: 'local', worktree: 'review-sync', line: 'review-sync' }
      }
    ],
    hostScope: { hostIds: ['local'], omittedHostIds: [] },
    totalCount: 4,
    truncated: true
  },
  _meta: { runtimeId: '00000000-0000-4000-8000-000000000009' }
}
