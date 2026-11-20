// GENERATED from real captures on 2026-11-16 (#20), then sanitized: names, emails, URLs,
// paths, ids, SHAs and titles are placeholders; key sets, enums, booleans and counts are real.
// Captured with Orca 1.4.259: `orca worktree list --json` and `orca worktree show --worktree <sel> --json`.
// The list's last row was added from a read-only capture with Orca 1.4.263 on 2026-11-20 (#32):
// the union of every live row's keys (cliProvenance, lineage, linkedItems, diffComments, …),
// sanitized the same way.

export const worktreeListEnvelope = {
  "id": "00000000-0000-4000-8000-000000000001",
  "ok": true,
  "result": {
    "worktrees": [
      {
        "id": "00000000-0000-4000-8000-000000000002::/Users/me/src/api",
        "identity": {
          "key": "wt2:local:00000000-0000-4000-8000-000000000003",
          "executionHostId": "local",
          "instanceId": "00000000-0000-4000-8000-000000000003"
        },
        "instanceId": "00000000-0000-4000-8000-000000000003",
        "repoId": "00000000-0000-4000-8000-000000000002",
        "projectId": "git:gitlab.example.com/acme/team-1/service-1",
        "hostId": "local",
        "projectHostSetupId": "00000000-0000-4000-8000-000000000002",
        "path": "/Users/me/src/api",
        "head": "0000000000000000000000000000000000000001",
        "branch": "refs/heads/dev",
        "isBare": false,
        "isMainWorktree": true,
        "displayName": "dev",
        "displayNameMode": "automatic",
        "comment": "",
        "linkedIssue": null,
        "linkedPR": null,
        "linkedLinearIssue": null,
        "linkedLinearIssueWorkspaceId": null,
        "linkedLinearIssueOrganizationUrlKey": null,
        "linkedGitLabMR": null,
        "linkedGitLabIssue": null,
        "linkedBitbucketPR": null,
        "linkedAzureDevOpsPR": null,
        "linkedGiteaPR": null,
        "linkedWorkItem": null,
        "linkedTaskSourceContext": null,
        "isArchived": false,
        "isUnread": false,
        "isPinned": false,
        "sortOrder": 1794815054345,
        "lastActivityAt": 1794814957687,
        "workspaceStatus": "in-progress",
        "parentWorktreeId": null,
        "childWorktreeIds": [],
        "lineage": null,
        "git": {
          "path": "/Users/me/src/api",
          "head": "0000000000000000000000000000000000000001",
          "branch": "refs/heads/dev",
          "isBare": false,
          "isMainWorktree": true
        },
        "linkedItems": []
      },
      {
        "id": "00000000-0000-4000-8000-000000000002::/Users/me/orca/workspaces/service/review-sync",
        "identity": {
          "key": "wt2:local:00000000-0000-4000-8000-000000000004",
          "executionHostId": "local",
          "instanceId": "00000000-0000-4000-8000-000000000004"
        },
        "instanceId": "00000000-0000-4000-8000-000000000004",
        "repoId": "00000000-0000-4000-8000-000000000002",
        "projectId": "git:gitlab.example.com/acme/team-1/service-1",
        "hostId": "local",
        "projectHostSetupId": "00000000-0000-4000-8000-000000000002",
        "creatorProvenance": {
          "kind": "host"
        },
        "path": "/Users/me/orca/workspaces/service/review-sync",
        "head": "0000000000000000000000000000000000000011",
        "branch": "refs/heads/feature/workspace-2",
        "isBare": false,
        "isMainWorktree": false,
        "displayName": "Review the sync job",
        "displayNameMode": "fixed",
        "comment": "",
        "linkedIssue": null,
        "linkedPR": null,
        "linkedLinearIssue": null,
        "linkedLinearIssueWorkspaceId": null,
        "linkedLinearIssueOrganizationUrlKey": null,
        "linkedGitLabMR": null,
        "linkedGitLabIssue": null,
        "linkedBitbucketPR": null,
        "linkedAzureDevOpsPR": null,
        "linkedGiteaPR": null,
        "linkedWorkItem": null,
        "linkedItems": [],
        "linkedTaskSourceContext": null,
        "isArchived": false,
        "isUnread": false,
        "isPinned": false,
        "sortOrder": 1794806787026,
        "lastActivityAt": 1794806784000,
        "createdAt": 1794800076622,
        "createdWithAgent": "claude",
        "pendingFirstAgentMessageRename": false,
        "firstAgentMessageRenameError": null,
        "baseRef": "dev",
        "workspaceStatus": "in-progress",
        "diffComments": [],
        "parentWorktreeId": null,
        "childWorktreeIds": [],
        "lineage": null,
        "git": {
          "path": "/Users/me/orca/workspaces/service/review-sync",
          "head": "0000000000000000000000000000000000000011",
          "branch": "refs/heads/feature/workspace-2",
          "isBare": false,
          "isMainWorktree": false
        }
      },
      {
        "id": "00000000-0000-4000-8000-000000000005::/Users/me/src/web",
        "identity": {
          "key": "wt2:local:00000000-0000-4000-8000-000000000006",
          "executionHostId": "local",
          "instanceId": "00000000-0000-4000-8000-000000000006"
        },
        "instanceId": "00000000-0000-4000-8000-000000000006",
        "repoId": "00000000-0000-4000-8000-000000000005",
        "projectId": "github:acme/project-2",
        "hostId": "local",
        "projectHostSetupId": "00000000-0000-4000-8000-000000000005",
        "path": "/Users/me/src/web",
        "head": "0000000000000000000000000000000000000012",
        "branch": "refs/heads/feature/workspace-3",
        "isBare": false,
        "isMainWorktree": true,
        "displayName": "feature/workspace-3",
        "displayNameMode": "automatic",
        "comment": "",
        "linkedIssue": null,
        "linkedPR": null,
        "linkedLinearIssue": null,
        "linkedLinearIssueWorkspaceId": null,
        "linkedLinearIssueOrganizationUrlKey": null,
        "linkedGitLabMR": null,
        "linkedGitLabIssue": null,
        "linkedBitbucketPR": null,
        "linkedAzureDevOpsPR": null,
        "linkedGiteaPR": null,
        "linkedWorkItem": null,
        "linkedTaskSourceContext": null,
        "isArchived": false,
        "isUnread": false,
        "isPinned": false,
        "sortOrder": 1794828443273,
        "lastActivityAt": 1794810641243,
        "workspaceStatus": "in-progress",
        "parentWorktreeId": null,
        "childWorktreeIds": [],
        "lineage": null,
        "git": {
          "path": "/Users/me/src/web",
          "head": "0000000000000000000000000000000000000012",
          "branch": "refs/heads/feature/workspace-3",
          "isBare": false,
          "isMainWorktree": true
        },
        "linkedItems": []
      },
      {
        "id": "00000000-0000-4000-8000-000000000007::/Users/me/src/tools",
        "identity": {
          "key": "wt2:local:00000000-0000-4000-8000-000000000008",
          "executionHostId": "local",
          "instanceId": "00000000-0000-4000-8000-000000000008"
        },
        "instanceId": "00000000-0000-4000-8000-000000000008",
        "repoId": "00000000-0000-4000-8000-000000000007",
        "projectId": "github:acme/project-3",
        "hostId": "local",
        "projectHostSetupId": "00000000-0000-4000-8000-000000000007",
        "path": "/Users/me/src/tools",
        "head": "0000000000000000000000000000000000000013",
        "branch": "refs/heads/main",
        "isBare": false,
        "isMainWorktree": true,
        "displayName": "main",
        "displayNameMode": "automatic",
        "comment": "",
        "linkedIssue": null,
        "linkedPR": null,
        "linkedLinearIssue": null,
        "linkedLinearIssueWorkspaceId": null,
        "linkedLinearIssueOrganizationUrlKey": null,
        "linkedGitLabMR": null,
        "linkedGitLabIssue": null,
        "linkedBitbucketPR": null,
        "linkedAzureDevOpsPR": null,
        "linkedGiteaPR": null,
        "linkedWorkItem": null,
        "linkedTaskSourceContext": null,
        "isArchived": false,
        "isUnread": false,
        "isPinned": false,
        "sortOrder": 1794828444895,
        "lastActivityAt": 1794831900970,
        "workspaceStatus": "in-progress",
        "parentWorktreeId": null,
        "childWorktreeIds": [],
        "lineage": null,
        "git": {
          "path": "/Users/me/src/tools",
          "head": "0000000000000000000000000000000000000013",
          "branch": "refs/heads/main",
          "isBare": false,
          "isMainWorktree": true
        },
        "linkedItems": []
      },
      {
        "id": "00000000-0000-4000-8000-000000000101::/work/me/orca/workspaces/api/ACME-9-child",
        "identity": {
          "key": "wt2:local:00000000-0000-4000-8000-000000000102",
          "executionHostId": "local",
          "instanceId": "00000000-0000-4000-8000-000000000102"
        },
        "instanceId": "00000000-0000-4000-8000-000000000102",
        "repoId": "00000000-0000-4000-8000-000000000101",
        "projectId": "git:gitlab.example.com/acme/api",
        "hostId": "local",
        "projectHostSetupId": "00000000-0000-4000-8000-000000000101",
        "path": "/work/me/orca/workspaces/api/ACME-9-child",
        "head": "0000000000000000000000000000000000000031",
        "branch": "refs/heads/feature/ACME-9-child",
        "isBare": false,
        "isMainWorktree": false,
        "displayName": "ACME-9 Add retry",
        "displayNameMode": "fixed",
        "comment": "",
        "linkedIssue": 9,
        "linkedPR": null,
        "linkedLinearIssue": "ACME-9",
        "linkedLinearIssueWorkspaceId": "00000000-0000-4000-8000-000000000120",
        "linkedLinearIssueOrganizationUrlKey": "acme",
        "linkedGitLabMR": null,
        "linkedGitLabIssue": null,
        "linkedBitbucketPR": null,
        "linkedAzureDevOpsPR": null,
        "linkedGiteaPR": null,
        "linkedWorkItem": {
          "provider": "linear",
          "type": "issue",
          "number": 9,
          "title": "Add retry",
          "url": "https://linear.app/acme/issue/ACME-9/add-retry",
          "linearIdentifier": "ACME-9"
        },
        "linkedTaskSourceContext": {
          "kind": "task-source",
          "provider": "linear",
          "projectId": "git:gitlab.example.com/acme/api",
          "hostId": "local",
          "projectHostSetupId": "00000000-0000-4000-8000-000000000101",
          "repoId": "00000000-0000-4000-8000-000000000101",
          "providerIdentity": {
            "provider": "linear",
            "workspaceId": "00000000-0000-4000-8000-000000000120",
            "workspaceName": "Acme",
            "teamId": null,
            "teamKey": null,
            "owner": "acme",
            "repo": "api"
          },
          "accountLabel": "Acme"
        },
        "isArchived": false,
        "isUnread": false,
        "isPinned": false,
        "sortOrder": 1794831300000,
        "lastActivityAt": 1794831360000,
        "pendingFirstAgentMessageRename": false,
        "firstAgentMessageRenameError": null,
        "workspaceStatus": "in-progress",
        "diffComments": [
          {
            "worktreeId": "00000000-0000-4000-8000-000000000101::/work/me/orca/workspaces/api/ACME-9-child",
            "filePath": "src/sync.ts",
            "source": "diff",
            "lineNumber": 3,
            "body": "Retry only on 5xx.",
            "side": "modified",
            "id": "00000000-0000-4000-8000-000000000121",
            "createdAt": 1794831540000
          }
        ],
        "parentWorktreeId": "00000000-0000-4000-8000-000000000103::/work/me/src/api",
        "childWorktreeIds": [
          "00000000-0000-4000-8000-000000000104::/work/me/orca/workspaces/api/ACME-9-grandchild"
        ],
        "lineage": {
          "worktreeId": "00000000-0000-4000-8000-000000000101::/work/me/orca/workspaces/api/ACME-9-child",
          "worktreeInstanceId": "00000000-0000-4000-8000-000000000102",
          "parentWorktreeId": "00000000-0000-4000-8000-000000000103::/work/me/src/api",
          "parentWorktreeInstanceId": "00000000-0000-4000-8000-000000000105",
          "origin": "cli",
          "capture": {
            "source": "explicit-cli-flag",
            "confidence": "explicit"
          },
          "createdAt": 1794831960000
        },
        "git": {
          "path": "/work/me/orca/workspaces/api/ACME-9-child",
          "head": "0000000000000000000000000000000000000031",
          "branch": "refs/heads/feature/ACME-9-child",
          "isBare": false,
          "isMainWorktree": false
        },
        "linkedItems": [
          {
            "provider": "linear",
            "type": "issue",
            "number": 9,
            "identifier": "ACME-9",
            "title": "Add retry",
            "url": "https://linear.app/acme/issue/ACME-9/add-retry",
            "linearIdentifier": "ACME-9",
            "linearWorkspaceId": "00000000-0000-4000-8000-000000000120",
            "linearOrganizationUrlKey": "acme",
            "taskSourceContext": {
              "kind": "task-source",
              "provider": "linear",
              "projectId": "git:gitlab.example.com/acme/api",
              "hostId": "local",
              "projectHostSetupId": "00000000-0000-4000-8000-000000000101",
              "repoId": "00000000-0000-4000-8000-000000000101",
              "providerIdentity": {
                "provider": "linear",
                "workspaceId": "00000000-0000-4000-8000-000000000120",
                "workspaceName": "Acme",
                "teamId": null,
                "teamKey": null,
                "owner": "acme",
                "repo": "api"
              },
              "accountLabel": "Acme"
            }
          }
        ],
        "creatorProvenance": {
          "kind": "host"
        },
        "createdAt": 1794832380000,
        "createdWithAgent": "claude",
        "baseRef": "main",
        "cliProvenance": {
          "kind": "created-by-cli",
          "createdAt": 1794832440000,
          "callerTerminalHandle": "term_00000000-0000-4000-8000-000000000106",
          "startupAgent": "claude"
        }
      }
    ],
    "hostScope": {
      "hostIds": [
        "local"
      ],
      "omittedHostIds": []
    },
    "totalCount": 5,
    "truncated": false
  },
  "_meta": {
    "runtimeId": "00000000-0000-4000-8000-000000000009"
  }
}

/** The workspace that `show` returned `diffComments` (empty) and `baseRef` for. */
export const worktreeShowEnvelope = {
  "id": "00000000-0000-4000-8000-00000000000a",
  "ok": true,
  "result": {
    "worktree": {
      "id": "00000000-0000-4000-8000-000000000002::/Users/me/orca/workspaces/service/review-sync",
      "identity": {
        "key": "wt2:local:00000000-0000-4000-8000-000000000004",
        "executionHostId": "local",
        "instanceId": "00000000-0000-4000-8000-000000000004"
      },
      "instanceId": "00000000-0000-4000-8000-000000000004",
      "repoId": "00000000-0000-4000-8000-000000000002",
      "projectId": "git:gitlab.example.com/acme/team-1/service-1",
      "hostId": "local",
      "projectHostSetupId": "00000000-0000-4000-8000-000000000002",
      "creatorProvenance": {
        "kind": "host"
      },
      "path": "/Users/me/orca/workspaces/service/review-sync",
      "head": "0000000000000000000000000000000000000011",
      "branch": "refs/heads/feature/workspace-2",
      "isBare": false,
      "isMainWorktree": false,
      "displayName": "Review the sync job",
      "displayNameMode": "fixed",
      "comment": "",
      "linkedIssue": null,
      "linkedPR": null,
      "linkedLinearIssue": null,
      "linkedLinearIssueWorkspaceId": null,
      "linkedLinearIssueOrganizationUrlKey": null,
      "linkedGitLabMR": null,
      "linkedGitLabIssue": null,
      "linkedBitbucketPR": null,
      "linkedAzureDevOpsPR": null,
      "linkedGiteaPR": null,
      "linkedWorkItem": null,
      "linkedItems": [],
      "linkedTaskSourceContext": null,
      "isArchived": false,
      "isUnread": false,
      "isPinned": false,
      "sortOrder": 1794806787026,
      "lastActivityAt": 1794806784000,
      "createdAt": 1794800076622,
      "createdWithAgent": "claude",
      "pendingFirstAgentMessageRename": false,
      "firstAgentMessageRenameError": null,
      "baseRef": "dev",
      "workspaceStatus": "in-progress",
      "diffComments": [],
      "parentWorktreeId": null,
      "childWorktreeIds": [],
      "lineage": null,
      "git": {
        "path": "/Users/me/orca/workspaces/service/review-sync",
        "head": "0000000000000000000000000000000000000011",
        "branch": "refs/heads/feature/workspace-2",
        "isBare": false,
        "isMainWorktree": false
      },
      "workspaceLineage": null,
      "environment": {
        "id": "local",
        "name": "local"
      },
      "parent": null,
      "address": {
        "environment": "local",
        "worktree": "identity:wt2:local:00000000-0000-4000-8000-000000000004",
        "line": "--environment local --worktree identity:wt2:local:00000000-0000-4000-8000-000000000004"
      }
    }
  },
  "_meta": {
    "runtimeId": "00000000-0000-4000-8000-000000000009"
  }
}

/** `orca worktree show --worktree id:nope --json`: printed on stdout, exit code 1. */
export const worktreeShowErrorEnvelope = {
  "id": "00000000-0000-4000-8000-00000000000b",
  "ok": false,
  "error": {
    "code": "selector_not_found",
    "message": "selector_not_found",
    "data": {
      "selector": "id:nope",
      "validSelectorForms": [
        "id:<repo-id>::<absolute-path>",
        "folder:<folder-id>",
        "path:<absolute-path>",
        "name:<display-name>",
        "branch:<branch>",
        "identity:<identity-key>",
        "issue:<number>",
        "current",
        "active"
      ],
      "suggestions": [
        "id:nope::<absolute-path>",
        "path:<absolute-path>"
      ],
      "nextSteps": [
        "No Orca workspace matched the worktree selector \"id:nope\".",
        "Did you mean: id:nope::<absolute-path>, path:<absolute-path>",
        "Valid selector forms: id:<repo-id>::<absolute-path>, folder:<folder-id>, path:<absolute-path>, name:<display-name>, branch:<branch>, identity:<identity-key>, issue:<number>, current, active.",
        "List the exact values, folder workspaces included, with `orca worktree ps --json` (add `--environment <id>` for a workspace in another environment); a bare repository id is not a worktree id."
      ]
    }
  },
  "_meta": {
    "runtimeId": "00000000-0000-4000-8000-000000000009"
  }
}
