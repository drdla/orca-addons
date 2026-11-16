// GENERATED from real captures on 2026-11-16 (#20), then sanitized: names, emails, URLs,
// paths, ids, SHAs and titles are placeholders; key sets, enums, booleans and counts are real.
// Captured with `glab api --hostname gitlab.com` (read-only) against GitLab 19.6.0-pre.

/** The HTTP body of the Review Requests GraphQL query (REVIEW_REQUESTS_QUERY). */
export const reviewRequestsBody = {
  "data": {
    "currentUser": {
      "username": "me",
      "reviewRequestedMergeRequests": {
        "count": 7,
        "pageInfo": {
          "hasNextPage": false,
          "endCursor": "eyJ1cGRhdGVkX2F0IjoiMjAyNi0xMC0wNlQxMTo1NzoxNFoiLCJpZCI6IjkwMDcifQ=="
        },
        "nodes": [
          {
            "id": "gid://gitlab/MergeRequest/9001",
            "iid": "101",
            "title": "Add retry to the nightly sync job",
            "webUrl": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/101",
            "draft": false,
            "state": "opened",
            "createdAt": "2026-11-06T09:49:03Z",
            "updatedAt": "2026-11-16T08:00:00Z",
            "sourceBranch": "feature/change-1",
            "targetBranch": "dev",
            "diffRefs": {
              "baseSha": "0000000000000000000000000000000000000001",
              "headSha": "0000000000000000000000000000000000000002",
              "startSha": "0000000000000000000000000000000000000001"
            },
            "project": {
              "fullPath": "acme/team-1/service-1",
              "group": {
                "fullPath": "acme/team-1"
              }
            },
            "author": {
              "username": "author-1",
              "name": "Author 1"
            },
            "labels": {
              "nodes": [
                {
                  "title": "backend"
                }
              ]
            },
            "reviewers": {
              "nodes": [
                {
                  "username": "me",
                  "mergeRequestInteraction": {
                    "reviewState": "UNREVIEWED",
                    "approved": false,
                    "reviewed": false
                  }
                }
              ]
            }
          },
          {
            "id": "gid://gitlab/MergeRequest/9002",
            "iid": "102",
            "title": "Show the invoice total in the header",
            "webUrl": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/102",
            "draft": false,
            "state": "opened",
            "createdAt": "2026-11-12T14:00:51Z",
            "updatedAt": "2026-11-13T09:18:39Z",
            "sourceBranch": "feature/change-2",
            "targetBranch": "dev",
            "diffRefs": {
              "baseSha": "0000000000000000000000000000000000000003",
              "headSha": "0000000000000000000000000000000000000004",
              "startSha": "0000000000000000000000000000000000000005"
            },
            "project": {
              "fullPath": "acme/team-1/service-1",
              "group": {
                "fullPath": "acme/team-1"
              }
            },
            "author": {
              "username": "author-2",
              "name": "Author 2"
            },
            "labels": {
              "nodes": [
                {
                  "title": "backend"
                }
              ]
            },
            "reviewers": {
              "nodes": [
                {
                  "username": "me",
                  "mergeRequestInteraction": {
                    "reviewState": "UNREVIEWED",
                    "approved": false,
                    "reviewed": false
                  }
                }
              ]
            }
          },
          {
            "id": "gid://gitlab/MergeRequest/9003",
            "iid": "103",
            "title": "Fix flaky date parsing in reports",
            "webUrl": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/103",
            "draft": false,
            "state": "opened",
            "createdAt": "2026-11-12T09:26:39Z",
            "updatedAt": "2026-11-13T07:23:08Z",
            "sourceBranch": "feature/change-3",
            "targetBranch": "dev",
            "diffRefs": {
              "baseSha": "0000000000000000000000000000000000000006",
              "headSha": "0000000000000000000000000000000000000007",
              "startSha": "0000000000000000000000000000000000000008"
            },
            "project": {
              "fullPath": "acme/team-1/service-1",
              "group": {
                "fullPath": "acme/team-1"
              }
            },
            "author": {
              "username": "author-3",
              "name": "Author 3"
            },
            "labels": {
              "nodes": [
                {
                  "title": "frontend"
                },
                {
                  "title": "backend"
                }
              ]
            },
            "reviewers": {
              "nodes": [
                {
                  "username": "me",
                  "mergeRequestInteraction": {
                    "reviewState": "UNREVIEWED",
                    "approved": false,
                    "reviewed": false
                  }
                }
              ]
            }
          },
          {
            "id": "gid://gitlab/MergeRequest/9004",
            "iid": "104",
            "title": "Bump the HTTP client to the latest minor",
            "webUrl": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/104",
            "draft": false,
            "state": "opened",
            "createdAt": "2026-11-11T09:46:42Z",
            "updatedAt": "2026-11-12T13:29:50Z",
            "sourceBranch": "feature/change-4",
            "targetBranch": "dev",
            "diffRefs": {
              "baseSha": "0000000000000000000000000000000000000003",
              "headSha": "0000000000000000000000000000000000000009",
              "startSha": "0000000000000000000000000000000000000003"
            },
            "project": {
              "fullPath": "acme/team-1/service-1",
              "group": {
                "fullPath": "acme/team-1"
              }
            },
            "author": {
              "username": "author-2",
              "name": "Author 2"
            },
            "labels": {
              "nodes": [
                {
                  "title": "backend"
                }
              ]
            },
            "reviewers": {
              "nodes": [
                {
                  "username": "me",
                  "mergeRequestInteraction": {
                    "reviewState": "UNREVIEWED",
                    "approved": false,
                    "reviewed": false
                  }
                }
              ]
            }
          },
          {
            "id": "gid://gitlab/MergeRequest/9005",
            "iid": "105",
            "title": "Remove the legacy export endpoint",
            "webUrl": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/105",
            "draft": false,
            "state": "opened",
            "createdAt": "2026-10-27T15:07:13Z",
            "updatedAt": "2026-11-10T07:27:27Z",
            "sourceBranch": "feature/change-5",
            "targetBranch": "dev",
            "diffRefs": {
              "baseSha": "000000000000000000000000000000000000000a",
              "headSha": "000000000000000000000000000000000000000b",
              "startSha": "000000000000000000000000000000000000000a"
            },
            "project": {
              "fullPath": "acme/team-1/service-1",
              "group": {
                "fullPath": "acme/team-1"
              }
            },
            "author": {
              "username": "author-4",
              "name": "Author 4"
            },
            "labels": {
              "nodes": [
                {
                  "title": "backend"
                }
              ]
            },
            "reviewers": {
              "nodes": [
                {
                  "username": "me",
                  "mergeRequestInteraction": {
                    "reviewState": "UNREVIEWED",
                    "approved": false,
                    "reviewed": false
                  }
                }
              ]
            }
          },
          {
            "id": "gid://gitlab/MergeRequest/9006",
            "iid": "106",
            "title": "Cache the permissions lookup per request",
            "webUrl": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/106",
            "draft": false,
            "state": "opened",
            "createdAt": "2026-08-24T08:43:00Z",
            "updatedAt": "2026-10-12T05:34:41Z",
            "sourceBranch": "feature/change-6",
            "targetBranch": "dev",
            "diffRefs": {
              "baseSha": "000000000000000000000000000000000000000c",
              "headSha": "000000000000000000000000000000000000000d",
              "startSha": "000000000000000000000000000000000000000e"
            },
            "project": {
              "fullPath": "acme/team-1/service-1",
              "group": {
                "fullPath": "acme/team-1"
              }
            },
            "author": {
              "username": "author-5",
              "name": "Author 5"
            },
            "labels": {
              "nodes": [
                {
                  "title": "backend"
                }
              ]
            },
            "reviewers": {
              "nodes": [
                {
                  "username": "me",
                  "mergeRequestInteraction": {
                    "reviewState": "UNAPPROVED",
                    "approved": false,
                    "reviewed": false
                  }
                }
              ]
            }
          },
          {
            "id": "gid://gitlab/MergeRequest/9007",
            "iid": "107",
            "title": "Document the release checklist",
            "webUrl": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/107",
            "draft": false,
            "state": "opened",
            "createdAt": "2026-09-29T08:48:31Z",
            "updatedAt": "2026-10-06T11:57:14Z",
            "sourceBranch": "feature/change-7",
            "targetBranch": "dev",
            "diffRefs": {
              "baseSha": "000000000000000000000000000000000000000f",
              "headSha": "0000000000000000000000000000000000000010",
              "startSha": "000000000000000000000000000000000000000e"
            },
            "project": {
              "fullPath": "acme/team-1/service-1",
              "group": {
                "fullPath": "acme/team-1"
              }
            },
            "author": {
              "username": "author-3",
              "name": "Author 3"
            },
            "labels": {
              "nodes": [
                {
                  "title": "backend"
                }
              ]
            },
            "reviewers": {
              "nodes": [
                {
                  "username": "me",
                  "mergeRequestInteraction": {
                    "reviewState": "UNREVIEWED",
                    "approved": false,
                    "reviewed": false
                  }
                }
              ]
            }
          }
        ]
      }
    }
  }
}

/** `GET /projects/:id/merge_requests/:iid` for the first Review Request, trimmed to the fields the plugin may read. */
export const mergeRequestBody = {
  "id": 9001,
  "iid": 101,
  "project_id": 501,
  "title": "Add retry to the nightly sync job",
  "description": "Adds a retry with backoff around the nightly sync.",
  "state": "opened",
  "created_at": "2026-11-06T09:49:03.484Z",
  "updated_at": "2026-11-16T08:00:00.144Z",
  "merged_by": null,
  "merge_user": null,
  "merged_at": null,
  "closed_by": null,
  "closed_at": null,
  "target_branch": "dev",
  "source_branch": "feature/change-1",
  "user_notes_count": 3,
  "author": {
    "id": 2001,
    "username": "author-1",
    "public_email": "",
    "name": "Author 1",
    "state": "active",
    "locked": false,
    "avatar_url": "https://gitlab.example.com/uploads/-/system/user/avatar/2001/avatar.png",
    "web_url": "https://gitlab.example.com/author-1",
    "bot": false
  },
  "reviewers": [
    {
      "id": 2002,
      "username": "me",
      "public_email": "",
      "name": "Me",
      "state": "active",
      "locked": false,
      "avatar_url": "https://gitlab.example.com/uploads/-/system/user/avatar/2002/avatar.png",
      "web_url": "https://gitlab.example.com/me"
    }
  ],
  "source_project_id": 501,
  "target_project_id": 501,
  "labels": [
    "backend"
  ],
  "draft": false,
  "work_in_progress": false,
  "merge_status": "unchecked",
  "detailed_merge_status": "unchecked",
  "sha": "0000000000000000000000000000000000000002",
  "reference": "!101",
  "references": {
    "short": "!101",
    "relative": "!101",
    "full": "acme/team-1/service-1!101"
  },
  "web_url": "https://gitlab.example.com/acme/team-1/service-1/-/merge_requests/101",
  "has_conflicts": false,
  "blocking_discussions_resolved": true,
  "diff_refs": {
    "base_sha": "0000000000000000000000000000000000000001",
    "head_sha": "0000000000000000000000000000000000000002",
    "start_sha": "0000000000000000000000000000000000000001"
  },
  "user": {
    "can_merge": true
  }
}

/** `GET /projects/:id/merge_requests/:iid/draft_notes` with no pending drafts: the only state that could be captured read-only. */
export const draftNotesListBody: unknown[] = []

/** stdout of `glab api --include` for a 404 (glab also exits 1 and prints `glab: 404 Project Not Found (HTTP 404)` on stderr). */
export const glabNotFoundOutput = "HTTP/2.0 404 Not Found\nContent-Type: application/json\r\nDate: Mon, 16 Nov 2026 09:00:00 GMT\r\nRatelimit-Limit: 2000\r\nRatelimit-Name: throttle_authenticated_api\r\nRatelimit-Observed: 9\r\nRatelimit-Remaining: 1991\r\nRatelimit-Reset: 1794844920\r\nX-Gitlab-Meta: {\"correlation_id\":\"0000000000000000-AAA\",\"version\":\"1\"}\r\nX-Request-Id: 0000000000000000-AAA\r\n\r\n{\"message\":\"404 Project Not Found\"}"

/** stdout of `glab api graphql --include` when the query has an error: HTTP 200, glab exits 1. */
export const glabGraphqlErrorOutput = "HTTP/2.0 200 OK\nContent-Type: application/json; charset=utf-8\r\nDate: Mon, 16 Nov 2026 09:00:00 GMT\r\nEtag: W/\"00000000000000000000000000000000\"\r\nRatelimit-Limit: 2000\r\nRatelimit-Name: throttle_authenticated_api\r\nRatelimit-Observed: 1\r\nRatelimit-Remaining: 1999\r\nRatelimit-Reset: 1794844920\r\nX-Gitlab-Meta: {\"correlation_id\":\"0000000000000000-AAA\",\"version\":\"1\"}\r\nX-Request-Id: 0000000000000000-AAA\r\n\r\n{\"errors\":[{\"message\":\"Field 'nope' doesn't exist on type 'CurrentUser'\",\"locations\":[{\"line\":1,\"column\":25}],\"path\":[\"query Q\",\"currentUser\",\"nope\"],\"extensions\":{\"code\":\"undefinedField\",\"typeName\":\"CurrentUser\",\"fieldName\":\"nope\"}}]}"

