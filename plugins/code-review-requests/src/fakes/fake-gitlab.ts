// An in-memory, stateful GitLab that implements GitLabTransport. It holds MRs, reviewers,
// approvals and draft notes, and answers the plugin's GraphQL query and REST calls from that
// state, so posting a review or approving changes what the next poll sees.
//
// Extend it when a slice needs another call: add a branch to graphql() (keyed by the query's
// operation name) or a route to rest(). Response shapes follow the research notes and, once #20
// lands, the sanitized fixtures.
import type { Clock } from '../seams/clock'
import {
  GitLabError,
  type GitLabTransport,
  type HttpMethod,
  type Json
} from '../seams/gitlab'
import type {
  PipelineStatus,
  ReviewRequestNode,
  ReviewRequestsResponse,
  ReviewState
} from '../gitlab/review-requests-query'
import type { DroppedMergeRequestResponse } from '../notify/explain-dropped'
import type { ApprovalsResponse } from '../gitlab/approvals'
import { FakeClock } from './fake-clock'

export type MergeRequestSeed = {
  projectPath: string
  iid?: number
  title?: string
  author?: string
  draft?: boolean
  state?: 'opened' | 'closed' | 'merged'
  /** Defaults to `[me]`. */
  reviewers?: string[]
  approvedBy?: string[]
  sourceBranch?: string
  targetBranch?: string
  labels?: string[]
  /** When the seeded reviewers were added (ms); defaults to now. */
  requestedAt?: number
  /** The head pipeline's status; none by default. */
  pipeline?: PipelineStatus
  /** Approvals the MR requires; 0 by default. */
  approvalsRequired?: number
  /** Unresolved threads on the MR; 0 by default. */
  openThreads?: number
  /** Resolved threads on the MR; 0 by default. */
  resolvedThreads?: number
  /** The MR description; empty by default. */
  description?: string
}

export type FakeMergeRequest = {
  id: number
  iid: number
  projectPath: string
  title: string
  author: string
  draft: boolean
  state: 'opened' | 'closed' | 'merged'
  reviewers: string[]
  approvedBy: string[]
  reviewStates: Record<string, ReviewState>
  /** When each reviewer was added (ms), what `GET …/reviewers` reports as `created_at`. */
  reviewersAddedAt: Record<string, number>
  sourceBranch: string
  targetBranch: string
  labels: string[]
  createdAt: number
  updatedAt: number
  diffRefs: { baseSha: string; startSha: string; headSha: string }
  /** MR diff versions, oldest first (`GET …/versions` answers newest first). */
  versions: FakeVersion[]
  draftNotes: FakeDraftNote[]
  reviews: FakeReview[]
  /** `path:line` positions whose drafts fail to publish (a line outside the diff). */
  outsideDiff: Set<string>
  /** Drafts containing one of these never publish. */
  refusedTexts: string[]
  /** How the next `bulk_publish` fails with a 500, if it does (see `failNextPublish`). */
  failingPublish: 'nothing-published' | 'notes-published' | null
  /** Bodies of the plain notes posted (`POST …/notes`), quick actions removed. */
  notes: string[]
  /** Every published note, oldest first, as `GET …/notes` lists them (newest first). */
  published: FakePublishedNote[]
  /** What `GET …/diffs` answers; none by default. */
  diffs: FakeDiff[]
  /** GitLab no longer shows it to the user (deleted, access lost). */
  hidden: boolean
  pipeline: PipelineStatus | null
  approvalsRequired: number
  openThreads: number
  resolvedThreads: number
  description: string
}

export type FakeVersion = { id: number; baseSha: string; startSha: string; headSha: string; createdAt: number }

export type FakeDraftNote = { id: number; author: string; note: string; position: Json | null }
export type FakeReview = { summary: string | null; reviewerState: string | null; notes: string[] }
/** A published note; `position` makes it a diff note. */
export type FakePublishedNote = { id: number; body: string; position: Json | null }
/** One file of `GET …/diffs` (only the fields read). */
export type FakeDiff = { old_path: string; new_path: string; diff: string; new_file?: boolean; deleted_file?: boolean }

export type FakeRequest = { operation: string; variables?: Record<string, Json>; body?: Json }

export type FakeGitLabOptions = {
  /** The logged-in user. */
  me?: string
  host?: string
  clock?: Clock
  /** The GraphQL page size; GitLab's is 100. */
  pageSize?: number
  /** What `GET /version` reports. */
  version?: string
  /** `ce`: the schema lacks the EE approval fields (`approvalsRequired`, `approvalsLeft`). */
  edition?: 'ee' | 'ce'
}

export class FakeGitLab implements GitLabTransport {
  readonly me: string
  readonly host: string
  /** Every call made, in order, for assertions such as "nothing was fetched". */
  readonly requests: FakeRequest[] = []
  version: string
  edition: 'ee' | 'ce'

  #clock: Clock
  #pageSize: number
  #mergeRequests: FakeMergeRequest[] = []
  #failures: GitLabError[] = []
  #nextId = 1
  #nextSha = 1
  /** Personal access tokens this GitLab accepts, with their scopes (#25). */
  #tokens = new Map<string, string[]>()
  /**
   * What `GET /personal_access_tokens/self` tells glab's own login: its scopes, or null for a
   * 404 (an OAuth login, which has no personal access token behind it).
   */
  glabScopes: string[] | null = null

  constructor(options: FakeGitLabOptions = {}) {
    this.me = options.me ?? 'me'
    this.host = options.host ?? 'gitlab.example.com'
    this.#clock = options.clock ?? new FakeClock()
    this.#pageSize = options.pageSize ?? 100
    this.version = options.version ?? '19.6.0'
    this.edition = options.edition ?? 'ee'
  }

  // --- Arrange: shape the instance ---------------------------------------------------------

  addMergeRequest(seed: MergeRequestSeed): FakeMergeRequest {
    const now = this.#clock.now()
    const id = this.#nextId++
    const reviewers = seed.reviewers ?? [this.me]
    const approvedBy = seed.approvedBy ?? []
    const mr: FakeMergeRequest = {
      id,
      iid: seed.iid ?? id,
      projectPath: seed.projectPath,
      title: seed.title ?? `Merge request ${seed.iid ?? id}`,
      author: seed.author ?? 'author',
      draft: seed.draft ?? false,
      state: seed.state ?? 'opened',
      reviewers,
      approvedBy,
      reviewStates: Object.fromEntries(
        reviewers.map((r) => [r, approvedBy.includes(r) ? 'APPROVED' : 'UNREVIEWED'])
      ),
      reviewersAddedAt: Object.fromEntries(reviewers.map((r) => [r, seed.requestedAt ?? now])),
      sourceBranch: seed.sourceBranch ?? `feature-${id}`,
      targetBranch: seed.targetBranch ?? 'main',
      labels: seed.labels ?? [],
      createdAt: now,
      updatedAt: now,
      diffRefs: { baseSha: this.#sha(), startSha: this.#sha(), headSha: this.#sha() },
      versions: [],
      draftNotes: [],
      reviews: [],
      outsideDiff: new Set(),
      refusedTexts: [],
      failingPublish: null,
      notes: [],
      published: [],
      diffs: [],
      hidden: false,
      pipeline: seed.pipeline ?? null,
      approvalsRequired: seed.approvalsRequired ?? 0,
      openThreads: seed.openThreads ?? 0,
      resolvedThreads: seed.resolvedThreads ?? 0,
      description: seed.description ?? ''
    }
    this.#addVersion(mr)
    this.#mergeRequests.push(mr)
    return mr
  }

  approve(projectPath: string, iid: number, username = this.me): void {
    const mr = this.#find(projectPath, iid)
    if (!mr.approvedBy.includes(username)) mr.approvedBy.push(username)
    mr.reviewStates[username] = 'APPROVED'
    this.#touch(mr)
  }

  /** A reviewer's state as GitLab reports it, for example REVIEWED after they comment. */
  setReviewState(projectPath: string, iid: number, state: ReviewState, username = this.me): void {
    const mr = this.#find(projectPath, iid)
    mr.reviewStates[username] = state
    this.#touch(mr)
  }

  merge(projectPath: string, iid: number): void {
    this.#touch(Object.assign(this.#find(projectPath, iid), { state: 'merged' as const }))
  }

  close(projectPath: string, iid: number): void {
    this.#touch(Object.assign(this.#find(projectPath, iid), { state: 'closed' as const }))
  }

  /** The user loses access (or the MR is deleted): GitLab no longer shows it to them. */
  hide(projectPath: string, iid: number): void {
    this.#find(projectPath, iid).hidden = true
  }

  markDraft(projectPath: string, iid: number, draft = true): void {
    this.#touch(Object.assign(this.#find(projectPath, iid), { draft }))
  }

  addReviewer(projectPath: string, iid: number, username = this.me): void {
    const mr = this.#find(projectPath, iid)
    if (!mr.reviewers.includes(username)) mr.reviewers.push(username)
    mr.reviewStates[username] = 'UNREVIEWED'
    mr.reviewersAddedAt[username] = this.#clock.now()
    this.#touch(mr)
  }

  removeReviewer(projectPath: string, iid: number, username = this.me): void {
    const mr = this.#find(projectPath, iid)
    mr.reviewers = mr.reviewers.filter((r) => r !== username)
    delete mr.reviewStates[username]
    delete mr.reviewersAddedAt[username]
    this.#touch(mr)
  }

  /** New commits on the MR: `diff_refs.head_sha` moves on. */
  push(projectPath: string, iid: number): void {
    const mr = this.#find(projectPath, iid)
    mr.diffRefs = { ...mr.diffRefs, headSha: this.#sha() }
    this.#addVersion(mr)
    this.#touch(mr)
  }

  /** Drafts on this line fail to publish (GitLab can't find it in the diff) and stay drafts. */
  outsideDiff(projectPath: string, iid: number, path: string, line: number): void {
    this.#find(projectPath, iid).outsideDiff.add(`${path}:${line}`)
  }

  /** Drafts whose text contains `text` never publish (a refusal the plugin can't work around). */
  refuseToPublish(projectPath: string, iid: number, text: string): void {
    this.#find(projectPath, iid).refusedTexts.push(text)
  }

  /**
   * The next `bulk_publish` answers 500. `notes-published` is what gitlab.com 19.7 did: the drafts
   * became notes but stayed drafts too, and the summary and reviewer state were never applied.
   */
  failNextPublish(projectPath: string, iid: number, how: 'nothing-published' | 'notes-published'): void {
    this.#find(projectPath, iid).failingPublish = how
  }

  /** The files `GET …/diffs` lists for the MR. */
  setDiffs(projectPath: string, iid: number, diffs: FakeDiff[]): void {
    this.#find(projectPath, iid).diffs = diffs
  }

  /** Reviews published with `bulk_publish` or a `/submit_review` note, oldest first. */
  reviewsOf(projectPath: string, iid: number): FakeReview[] {
    return this.#find(projectPath, iid).reviews
  }

  /** The plain notes posted on the MR (quick actions removed), oldest first. */
  notesOf(projectPath: string, iid: number): string[] {
    return this.#find(projectPath, iid).notes
  }

  /** The draft notes on the MR (anyone's), for assertions. */
  draftNotesOf(projectPath: string, iid: number): FakeDraftNote[] {
    return this.#find(projectPath, iid).draftNotes
  }

  /** Makes this GitLab accept a personal access token with these scopes. */
  issueToken(token: string, scopes: string[] = ['api', 'read_api']): void {
    this.#tokens.set(token, scopes)
  }

  /** The token expires or is revoked: from now on it gets a 401. */
  revokeToken(token: string): void {
    this.#tokens.delete(token)
  }

  /**
   * This GitLab as a token-mode connection sees it: unknown or revoked tokens get a 401, and a
   * token without `read_api`/`api` may only read `/user` and itself. The calls land in `requests`.
   */
  withToken(token: string): GitLabTransport {
    return {
      graphql: (query, variables) => {
        this.#checkToken(token, null)
        return this.graphql(query, variables)
      },
      rest: (method, path, body) => {
        this.#checkToken(token, path)
        if (method !== 'GET' && !this.#tokens.get(token)!.includes('api')) {
          this.requests.push({ operation: `token refused ${method} ${path}` })
          return Promise.reject(new GitLabError('rejected', `${this.host}: 403 insufficient_scope`, { status: 403 }))
        }
        if (method === 'GET' && path === '/personal_access_tokens/self') {
          this.requests.push({ operation: `${method} ${path}` })
          return Promise.resolve(this.#personalAccessToken(this.#tokens.get(token)!) as never)
        }
        return this.rest(method, path, body)
      }
    }
  }

  /** The next calls reject with these errors, one each, before calls succeed again. */
  failNext(...errors: GitLabError[]): void {
    this.#failures.push(...errors)
  }

  // --- GitLabTransport ---------------------------------------------------------------------

  async graphql<T>(query: string, variables: Record<string, Json> = {}): Promise<T> {
    const name = /^\s*query\s+(\w+)/.exec(query)?.[1] ?? 'anonymous'
    this.requests.push({ operation: `graphql ${name}`, variables })
    // The optional approvals query never takes a failNext() error, so tests that queue failures
    // for polls keep their order.
    if (name !== 'ReviewRequestApprovals') this.#maybeFail()
    if (this.edition === 'ce') {
      const unknown = /\b(approvalsRequired|approvalsLeft)\b/.exec(query)?.[1]
      if (unknown) {
        // As GitLab answers a query with a field its schema lacks: HTTP 200 with `errors`.
        throw new GitLabError('rejected', `Field '${unknown}' doesn't exist on type 'MergeRequest'`, { status: 200 })
      }
    }
    switch (name) {
      case 'ReviewRequests':
        return this.#reviewRequests(variables) as T
      case 'DroppedMergeRequest':
        return this.#droppedMergeRequest(variables) as T
      case 'ReviewRequestApprovals':
        return this.#approvals(variables) as T
      default:
        throw new GitLabError('rejected', `fake GitLab does not know the query ${name}`, {
          status: 400
        })
    }
  }

  async rest<T>(method: HttpMethod, path: string, body?: Json): Promise<T> {
    this.requests.push({ operation: `${method} ${path}`, ...(body === undefined ? {} : { body }) })
    this.#maybeFail()
    return this.#route(method, path, (body ?? {}) as Record<string, Json>) as T
  }

  // --- internals ---------------------------------------------------------------------------

  #checkToken(token: string, restPath: string | null): void {
    const scopes = this.#tokens.get(token)
    const operation = restPath === null ? 'graphql' : restPath
    if (scopes === undefined) {
      this.requests.push({ operation: `token rejected ${operation}` })
      throw new GitLabError('needs-you', `${this.host}: 401 Unauthorized`, { status: 401, reason: 'token-rejected' })
    }
    const readsAnything = scopes.includes('api') || scopes.includes('read_api')
    if (!readsAnything && restPath !== '/user' && restPath !== '/personal_access_tokens/self') {
      this.requests.push({ operation: `token refused ${operation}` })
      throw new GitLabError('rejected', `${this.host}: 403 insufficient_scope`, { status: 403 })
    }
  }

  /** `GET /personal_access_tokens/self`, in the documented shape. */
  #personalAccessToken(scopes: string[]): Json {
    return {
      id: 4,
      name: 'Orca Review Requests',
      revoked: false,
      created_at: '2026-11-01T09:00:00.000Z',
      description: null,
      scopes,
      user_id: FAKE_USER_ID,
      last_used_at: null,
      active: true,
      expires_at: null
    }
  }

  /** The optional approvals query (gitlab/approvals.ts): same list, approval fields only. */
  #approvals(variables: Record<string, Json>): ApprovalsResponse {
    const { currentUser } = this.#reviewRequests(variables)
    const page = currentUser.reviewRequestedMergeRequests
    return {
      currentUser: {
        reviewRequestedMergeRequests: {
          pageInfo: page.pageInfo,
          nodes: page.nodes.map((node) => {
            const mr = this.#mergeRequests.find((m) => this.#webUrl(m) === node.webUrl)!
            return {
              webUrl: node.webUrl,
              approvalsRequired: mr.approvalsRequired,
              approvalsLeft: Math.max(0, mr.approvalsRequired - mr.approvedBy.length)
            }
          })
        }
      }
    }
  }

  #reviewRequests(variables: Record<string, Json>): ReviewRequestsResponse {
    const me = typeof variables.me === 'string' ? variables.me : this.me
    const all = this.#mergeRequests
      .filter(
        (mr) =>
          mr.state === 'opened' &&
          !mr.draft &&
          !mr.hidden &&
          mr.reviewers.includes(this.me) &&
          !mr.approvedBy.includes(me)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
    const offset = typeof variables.after === 'string' ? Number(variables.after) : 0
    const nodes = all.slice(offset, offset + this.#pageSize)
    const hasNextPage = offset + this.#pageSize < all.length
    return {
      currentUser: {
        username: this.me,
        reviewRequestedMergeRequests: {
          count: all.length,
          pageInfo: { hasNextPage, endCursor: nodes.length ? String(offset + nodes.length) : null },
          nodes: nodes.map((mr) => this.#node(mr))
        }
      }
    }
  }

  /** One merge request's state, draft, approvals and reviewers (#7); null where it is hidden. */
  #droppedMergeRequest(variables: Record<string, Json>): DroppedMergeRequestResponse {
    const mr = this.#mergeRequests.find(
      (m) => m.projectPath === variables.project && String(m.iid) === variables.iid && !m.hidden
    )
    if (!mr) return { project: null }
    return {
      project: {
        mergeRequest: {
          state: mr.state,
          draft: mr.draft,
          approvedBy: { nodes: mr.approvedBy.map((username) => ({ username })) },
          reviewers: { nodes: mr.reviewers.map((username) => ({ username })) }
        }
      }
    }
  }

  #node(mr: FakeMergeRequest): ReviewRequestNode {
    const group = mr.projectPath.split('/').slice(0, -1).join('/')
    return {
      id: `gid://gitlab/MergeRequest/${mr.id}`,
      iid: String(mr.iid),
      title: mr.title,
      webUrl: this.#webUrl(mr),
      draft: mr.draft,
      state: mr.state,
      createdAt: new Date(mr.createdAt).toISOString(),
      updatedAt: new Date(mr.updatedAt).toISOString(),
      sourceBranch: mr.sourceBranch,
      targetBranch: mr.targetBranch,
      diffRefs: { ...mr.diffRefs },
      project: { fullPath: mr.projectPath, group: group ? { fullPath: group } : null },
      author: { username: mr.author, name: mr.author },
      labels: { nodes: mr.labels.map((title) => ({ title })) },
      reviewers: {
        nodes: mr.reviewers.map((username) => ({
          username,
          mergeRequestInteraction: {
            reviewState: mr.reviewStates[username] ?? 'UNREVIEWED',
            approved: mr.approvedBy.includes(username),
            reviewed: (mr.reviewStates[username] ?? 'UNREVIEWED') !== 'UNREVIEWED'
          }
        }))
      },
      resolvableDiscussionsCount: mr.openThreads + mr.resolvedThreads,
      resolvedDiscussionsCount: mr.resolvedThreads,
      headPipeline: mr.pipeline === null ? null : { status: mr.pipeline }
    }
  }

  #route(method: HttpMethod, path: string, body: Record<string, Json>): Json {
    if (method === 'GET' && path === '/user') {
      return { id: FAKE_USER_ID, username: this.me, name: this.me }
    }
    if (method === 'GET' && path === '/version') return { version: this.version }
    if (method === 'GET' && path === '/personal_access_tokens/self') {
      if (this.glabScopes === null) throw new GitLabError('rejected', `${this.host}: 404 Not Found`, { status: 404 })
      return this.#personalAccessToken(this.glabScopes)
    }

    const [route = '', query = ''] = path.split('?')
    const m = /^\/projects\/([^/]+)\/merge_requests\/(\d+)(\/.*)?$/.exec(route)
    if (m) {
      const mr = this.#find(decodeURIComponent(m[1]!), Number(m[2]))
      const rest = m[3] ?? ''
      const draft = /^\/draft_notes\/(\d+)$/.exec(rest)
      if (method === 'GET' && rest === '') return this.#restMergeRequest(mr)
      if (method === 'GET' && rest === '/reviewers') return this.#restReviewers(mr)
      if (method === 'POST' && rest === '/approve') {
        if (typeof body.sha === 'string' && body.sha !== mr.diffRefs.headSha) {
          throw new GitLabError('rejected', 'SHA does not match HEAD of source branch', {
            status: 409
          })
        }
        this.approve(mr.projectPath, mr.iid)
        return { approved: true }
      }
      if (method === 'GET' && rest === '/draft_notes') {
        return mr.draftNotes.filter((d) => d.author === this.me).map((d) => restDraftNote(d, mr.id))
      }
      if (method === 'POST' && rest === '/draft_notes') {
        if (typeof body.note !== 'string' || body.note === '') {
          throw new GitLabError('rejected', 'note is missing', { status: 400 })
        }
        const created: FakeDraftNote = {
          id: this.#nextId++,
          author: this.me,
          note: body.note,
          position: body.position ?? null
        }
        mr.draftNotes.push(created)
        if (mr.reviewers.includes(this.me)) mr.reviewStates[this.me] = 'REVIEW_STARTED'
        return restDraftNote(created, mr.id)
      }
      if (method === 'DELETE' && draft) {
        const id = Number(draft[1])
        if (!mr.draftNotes.some((d) => d.id === id)) throw notFound(path)
        mr.draftNotes = mr.draftNotes.filter((d) => d.id !== id)
        return null
      }
      if (method === 'POST' && rest === '/draft_notes/bulk_publish') {
        // `note` and `reviewer_state` are declared from 19.2 on; older GitLab ignores them.
        const takesSummary = atLeast(this.version, 19, 2)
        const failing = mr.failingPublish
        if (failing !== null) {
          mr.failingPublish = null
          if (failing === 'notes-published') {
            for (const d of mr.draftNotes.filter((d) => d.author === this.me)) {
              mr.published.push({ id: this.#nextId++, body: d.note, position: d.position })
            }
          }
          throw new GitLabError('rejected', `${this.host}: 500 Internal Server Error`, { status: 500 })
        }
        const summary = takesSummary && typeof body.note === 'string' ? body.note : null
        this.#publish(mr, summary, takesSummary && typeof body.reviewer_state === 'string' ? body.reviewer_state : null)
        if (summary !== null) mr.published.push({ id: this.#nextId++, body: summary, position: null })
        return null
      }
      if (method === 'GET' && rest === '/diffs') {
        // Paged like GitLab: `page` (from 1) and `per_page` (default 20).
        const params = new URLSearchParams(query)
        const perPage = Number(params.get('per_page') ?? 20)
        const page = Number(params.get('page') ?? 1)
        return mr.diffs.slice((page - 1) * perPage, page * perPage) as unknown as Json
      }
      if (method === 'GET' && rest === '/approvals') {
        return {
          approvals_required: mr.approvalsRequired,
          approvals_left: Math.max(0, mr.approvalsRequired - mr.approvedBy.length),
          approved_by: mr.approvedBy.map((username) => ({ user: { username, name: username } }))
        }
      }
      if (method === 'GET' && rest === '/notes') {
        return [...mr.published].reverse().map((n) => ({
          ...(this.#restNote(mr, n.body) as Record<string, Json>),
          id: n.id,
          type: n.position === null ? null : 'DiffNote',
          ...(n.position === null ? {} : { position: n.position })
        }))
      }
      if (method === 'GET' && rest === '/versions') {
        return [...mr.versions].reverse().map((v) => ({
          id: v.id,
          head_commit_sha: v.headSha,
          base_commit_sha: v.baseSha,
          start_commit_sha: v.startSha,
          created_at: new Date(v.createdAt).toISOString(),
          merge_request_id: mr.id,
          state: 'collected',
          real_size: '1',
          patch_id_sha: v.headSha
        }))
      }
      if (method === 'POST' && rest === '/notes') {
        if (typeof body.body !== 'string' || body.body.trim() === '') {
          throw new GitLabError('rejected', 'body is missing', { status: 400 })
        }
        // Quick actions run and leave the body; `/submit_review [state]` publishes the drafts (17.0+).
        const submit = /^\/submit_review(?:[ \t]+(\S+))?[ \t]*$/m.exec(body.body)
        const text = body.body.replace(/^\/\w+.*$/gm, '').trim()
        if (submit) {
          this.#publish(mr, text === '' ? null : text, submit[1] ?? 'reviewed')
        } else if (/^\/request_changes[ \t]*$/m.test(body.body) && mr.reviewers.includes(this.me)) {
          mr.reviewStates[this.me] = 'REQUESTED_CHANGES'
        }
        const note = this.#restNote(mr, text) as { id: number }
        if (text !== '') {
          mr.notes.push(text)
          mr.published.push({ id: note.id, body: text, position: null })
        }
        return note
      }
    }
    throw notFound(path)
  }

  /** Publishes my drafts as one review; those on a line outside the diff stay drafts. */
  #publish(mr: FakeMergeRequest, summary: string | null, reviewerState: string | null): void {
    const fails = (d: FakeDraftNote) => {
      const p = d.position as { new_path?: unknown; new_line?: unknown } | null
      if (mr.refusedTexts.some((text) => d.note.includes(text))) return true
      return p !== null && mr.outsideDiff.has(`${String(p.new_path)}:${String(p.new_line)}`)
    }
    const mine = mr.draftNotes.filter((d) => d.author === this.me && !fails(d))
    mr.draftNotes = mr.draftNotes.filter((d) => !mine.includes(d))
    for (const d of mine) mr.published.push({ id: this.#nextId++, body: d.note, position: d.position })
    mr.reviews.push({ summary, reviewerState, notes: mine.map((d) => d.note) })
    if (mr.reviewers.includes(this.me)) {
      mr.reviewStates[this.me] = reviewerState === 'requested_changes' ? 'REQUESTED_CHANGES' : 'REVIEWED'
    }
    this.#touch(mr)
  }

  /** In the documented note shape (src/fixtures/gitlab-docs-shapes.ts). */
  #restNote(mr: FakeMergeRequest, body: string): Json {
    const at = new Date(this.#clock.now()).toISOString()
    return {
      id: this.#nextId++,
      body,
      author: { id: FAKE_USER_ID, username: this.me, name: this.me, state: 'active', created_at: at },
      created_at: at,
      updated_at: at,
      system: false,
      noteable_id: mr.id,
      noteable_type: 'MergeRequest',
      noteable_iid: mr.iid,
      project_id: 1,
      resolvable: false,
      confidential: false,
      internal: false
    }
  }

  #addVersion(mr: FakeMergeRequest): void {
    mr.versions.push({ id: this.#nextId++, ...mr.diffRefs, createdAt: this.#clock.now() })
  }

  #restMergeRequest(mr: FakeMergeRequest): Json {
    return {
      id: mr.id,
      iid: mr.iid,
      title: mr.title,
      state: mr.state,
      draft: mr.draft,
      description: mr.description,
      web_url: this.#webUrl(mr),
      references: { full: `${mr.projectPath}!${mr.iid}` },
      labels: mr.labels,
      // The capture (src/fixtures) had no head_pipeline field to compare; send it only with a pipeline.
      ...(mr.pipeline === null ? {} : { head_pipeline: { status: mr.pipeline.toLowerCase() } }),
      source_branch: mr.sourceBranch,
      target_branch: mr.targetBranch,
      sha: mr.diffRefs.headSha,
      diff_refs: {
        base_sha: mr.diffRefs.baseSha,
        start_sha: mr.diffRefs.startSha,
        head_sha: mr.diffRefs.headSha
      },
      author: { username: mr.author, name: mr.author },
      reviewers: mr.reviewers.map((username) => ({ username, name: username }))
    }
  }

  /** In the captured shape (src/fixtures/gitlab-reviewers-capture.ts). */
  #restReviewers(mr: FakeMergeRequest): Json {
    return mr.reviewers.map((username, index) => ({
      user: {
        id: username === this.me ? FAKE_USER_ID : 1000 + index,
        username,
        public_email: '',
        name: username,
        state: 'active',
        locked: false,
        avatar_url: `https://${this.host}/uploads/${username}.png`,
        web_url: `https://${this.host}/${username}`
      },
      state: (mr.reviewStates[username] ?? 'UNREVIEWED').toLowerCase(),
      created_at: new Date(mr.reviewersAddedAt[username] ?? mr.createdAt).toISOString()
    }))
  }

  #webUrl(mr: FakeMergeRequest): string {
    return `https://${this.host}/${mr.projectPath}/-/merge_requests/${mr.iid}`
  }

  #find(projectPath: string, iid: number): FakeMergeRequest {
    const mr = this.#mergeRequests.find((m) => m.projectPath === projectPath && m.iid === iid)
    if (!mr) throw notFound(`${projectPath}!${iid}`)
    return mr
  }

  #touch(mr: FakeMergeRequest): void {
    mr.updatedAt = Math.max(this.#clock.now(), mr.updatedAt + 1)
  }

  #maybeFail(): void {
    const failure = this.#failures.shift()
    if (failure) throw failure
  }

  #sha(): string {
    return (this.#nextSha++).toString(16).padStart(40, '0')
  }
}

/** In the documented draft-note shape (src/fixtures/gitlab-docs-shapes.ts). */
function restDraftNote(d: FakeDraftNote, mergeRequestId: number): Json {
  return {
    id: d.id,
    author_id: FAKE_USER_ID,
    merge_request_id: mergeRequestId,
    resolve_discussion: false,
    discussion_id: null,
    note: d.note,
    commit_id: null,
    line_code: null,
    position: d.position ?? GENERAL_NOTE_POSITION
  }
}

/** The id `GET /user` reports for the logged-in user. */
const FAKE_USER_ID = 1

/** What GitLab returns as `position` for a draft that isn't on a diff line. */
const GENERAL_NOTE_POSITION: Json = {
  base_sha: null,
  start_sha: null,
  head_sha: null,
  old_path: null,
  new_path: null,
  position_type: 'text',
  old_line: null,
  new_line: null,
  line_range: null
}

function atLeast(version: string, major: number, minor: number): boolean {
  const [a = 0, b = 0] = version.split('.').map(Number)
  return a > major || (a === major && b >= minor)
}

function notFound(what: string): GitLabError {
  return new GitLabError('rejected', `404 Not Found: ${what}`, { status: 404 })
}
