// GENERATED from real captures on 2026-11-16 (#20), then sanitized: names, emails, URLs,
// paths, ids, SHAs and titles are placeholders; key sets, enums, booleans and counts are real.
// Captured with Orca 1.4.259: `orca worktree list --json` and `orca worktree show --worktree <sel> --json`.

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
      }
    ],
    "hostScope": {
      "hostIds": [
        "local"
      ],
      "omittedHostIds": []
    },
    "totalCount": 4,
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
