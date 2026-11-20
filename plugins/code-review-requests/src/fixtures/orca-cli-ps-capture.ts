// GENERATED from a real capture on 2026-11-16 (#10), then sanitized like orca-cli-captures.ts:
// names, ids, paths, prompts and messages are placeholders; key sets, enums, booleans and counts
// are real. Captured with Orca 1.4.259: `orca worktree ps --json --limit 1`.
// The second row was added from a read-only `orca worktree ps --json` with Orca 1.4.263 on
// 2026-11-20 (#32): the union of every live row's keys (createdAt, creatorProvenance,
// agents[].subagents, linkedPR, parent, …), sanitized the same way. Orca 1.4.263 no longer sends
// agents[].workingMode; the first row keeps it.

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
      },
      {
        workspaceKind: 'git',
        worktreeId: '00000000-0000-4000-8000-000000000101::/work/me/orca/workspaces/api/ACME-9-child',
        repoId: '00000000-0000-4000-8000-000000000101',
        hostId: 'local',
        identity: {
          key: 'wt2:local:00000000-0000-4000-8000-000000000102',
          executionHostId: 'local',
          instanceId: '00000000-0000-4000-8000-000000000102'
        },
        terminalPlatform: 'darwin',
        repo: 'api',
        path: '/work/me/orca/workspaces/api/ACME-9-child',
        branch: 'feature/ACME-9-child',
        isArchived: false,
        isMainWorktree: false,
        hasHostSidebarActivity: true,
        defaultBranch: false,
        worktreeInstanceId: '00000000-0000-4000-8000-000000000102',
        parentWorktreeId: '00000000-0000-4000-8000-000000000103::/work/me/src/api',
        childWorktreeIds: [
          '00000000-0000-4000-8000-000000000104::/work/me/orca/workspaces/api/ACME-9-grandchild'
        ],
        workspaceLineage: null,
        displayName: 'ACME-9 Add retry',
        workspaceStatus: 'in-progress',
        sortOrder: 1794830940000,
        lastActivityAt: 1794831000000,
        createdAt: 1794831060000,
        creatorProvenance: {
          kind: 'host'
        },
        linkedIssue: 9,
        linkedPR: {
          number: 9,
          state: 'merged',
          title: 'Add retry to the nightly sync job',
          url: 'https://github.com/acme/api/pull/9',
          checksStatus: 'neutral',
          checksSummary: {
            state: 'none',
            total: 0,
            passed: 0,
            failed: 0,
            cancelled: 0,
            pending: 0,
            neutral: 0
          }
        },
        linkedLinearIssue: 'ACME-9',
        linkedGitLabMR: null,
        linkedGitLabIssue: null,
        linkedItems: [
          {
            provider: 'linear',
            type: 'issue',
            number: 9,
            identifier: 'ACME-9',
            title: 'Add retry',
            url: 'https://linear.app/acme/issue/ACME-9/add-retry',
            linearIdentifier: 'ACME-9',
            linearWorkspaceId: '00000000-0000-4000-8000-000000000120',
            linearOrganizationUrlKey: 'acme',
            taskSourceContext: {
              kind: 'task-source',
              provider: 'linear',
              projectId: 'git:gitlab.example.com/acme/api',
              hostId: 'local',
              projectHostSetupId: '00000000-0000-4000-8000-000000000101',
              repoId: '00000000-0000-4000-8000-000000000101',
              providerIdentity: {
                provider: 'linear',
                workspaceId: '00000000-0000-4000-8000-000000000120',
                workspaceName: 'Acme',
                teamId: null,
                teamKey: null,
                owner: 'acme',
                repo: 'api'
              },
              accountLabel: 'Acme'
            }
          }
        ],
        comment: '',
        isPinned: true,
        isActive: false,
        unread: true,
        liveTerminalCount: 2,
        hasAttachedPty: true,
        unverifiableTerminalCount: 0,
        lastOutputAt: 1794831480000,
        preview: 'Done. 12 tests pass.',
        status: 'active',
        agents: [
          {
            paneKey: '00000000-0000-4000-8000-000000000101::/work/me/orca/workspaces/api/ACME-9-child:pane-1',
            orcaSessionId: '00000000-0000-4000-8000-000000000107',
            parentPaneKey: null,
            state: 'done',
            agentType: 'claude',
            prompt: 'Add retry to the sync job.',
            taskTitle: null,
            displayName: null,
            conversationName: 'Add retry',
            lastAssistantMessage: 'Done. 12 tests pass.',
            toolName: 'Bash',
            toolInput: 'npm test',
            interrupted: false,
            mainAgent: {
              state: 'done',
              stateStartedAt: 1794831600000
            },
            stateStartedAt: 1794831660000,
            updatedAt: 1794831720000,
            hasLivePty: true,
            programStatus: {
              state: 'done',
              observedAt: 1794831780000
            },
            activity: {
              listed: true,
              status: 'done',
              unread: true,
              clearable: true,
              sortAt: 1794831840000,
              title: 'Add retry',
              childOf: '00000000-0000-4000-8000-000000000101::/work/me/orca/workspaces/api/ACME-9-child:pane-0',
              foldedChild: true
            },
            subagents: [
              {
                id: '00000000-0000-4000-8000-000000000108',
                state: 'working',
                startedAt: 1794831960000,
                agentType: 'general-purpose',
                description: 'Find the sync job'
              }
            ],
            subagentObservation: 'live'
          }
        ],
        sidebarStatus: 'working',
        terminalVerdict: 'live',
        environment: {
          id: 'local',
          name: 'local'
        },
        parent: {
          state: 'known',
          selector: 'identity:wt2:local:00000000-0000-4000-8000-000000000105',
          environment: {
            id: 'local',
            name: 'local'
          },
          address: {
            environment: 'local',
            worktree: 'identity:wt2:local:00000000-0000-4000-8000-000000000105',
            line: '--environment local --worktree identity:wt2:local:00000000-0000-4000-8000-000000000105'
          }
        },
        address: {
          environment: 'local',
          worktree: 'identity:wt2:local:00000000-0000-4000-8000-000000000102',
          line: '--environment local --worktree identity:wt2:local:00000000-0000-4000-8000-000000000102'
        },
        cliCreated: true,
        lineageWorktreeInstanceId: '00000000-0000-4000-8000-000000000102',
        parentWorktreeInstanceId: '00000000-0000-4000-8000-000000000105'
      }
    ],
    hostScope: { hostIds: ['local'], omittedHostIds: [] },
    totalCount: 4,
    truncated: true
  },
  _meta: { runtimeId: '00000000-0000-4000-8000-000000000009' }
}
