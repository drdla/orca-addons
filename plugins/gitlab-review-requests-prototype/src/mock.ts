// PROTOTYPE: mock Review Requests. No GitLab calls anywhere in this plugin.
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const now = Date.now()

export type Pipeline = 'success' | 'failed' | 'running' | 'none'
export type AgentReview = 'none' | 'running' | 'done'

export type ReviewRequest = {
  id: string
  iid: number
  title: string
  project: string // full path, e.g. platform/billing/invoice-service
  author: string
  requestedAt: number // when I was added as Reviewer
  updatedAt: number
  pipeline: Pipeline
  approvals: { given: number; required: number }
  comments: number
  isNew: boolean // appeared since the panel was last opened
  workspace: null | { name: string; agentReview: AgentReview; preparedNotes: number }
}

export type EndReason = 'approved' | 'merged' | 'closed' | 'reviewer removed'

export type EndedReviewRequest = {
  id: string
  iid: number
  title: string
  project: string
  reason: EndReason
  endedAt: number
  workspace: string
  skipped?: string // why auto-removal was skipped
}

export const reviewRequests: ReviewRequest[] = [
  {
    id: 'rr1',
    iid: 482,
    title: 'Add idempotency keys to invoice webhook handler',
    project: 'platform/billing/invoice-service',
    author: 'mkovac',
    requestedAt: now - 3 * DAY,
    updatedAt: now - 5 * HOUR,
    pipeline: 'success',
    approvals: { given: 1, required: 2 },
    comments: 7,
    isNew: false,
    workspace: { name: 'review/invoice-service-482', agentReview: 'done', preparedNotes: 4 }
  },
  {
    id: 'rr2',
    iid: 1291,
    title: 'Migrate delivery-note parser to the new OCR pipeline and drop the legacy fallback path',
    project: 'logistics/ingest/delivery-notes',
    author: 'sabine.h',
    requestedAt: now - 26 * HOUR,
    updatedAt: now - 40 * MIN,
    pipeline: 'failed',
    approvals: { given: 0, required: 1 },
    comments: 2,
    isNew: false,
    workspace: { name: 'review/delivery-notes-1291', agentReview: 'running', preparedNotes: 0 }
  },
  {
    id: 'rr3',
    iid: 77,
    title: 'Bump node to 22 in CI images',
    project: 'infra/ci-images',
    author: 'jlee',
    requestedAt: now - 6 * HOUR,
    updatedAt: now - 6 * HOUR,
    pipeline: 'running',
    approvals: { given: 0, required: 1 },
    comments: 0,
    isNew: false,
    workspace: null
  },
  {
    id: 'rr4',
    iid: 3104,
    title: 'Site picker: keyboard navigation and empty state',
    project: 'frontend/web-app',
    author: 'tpetrov',
    requestedAt: now - 25 * MIN,
    updatedAt: now - 25 * MIN,
    pipeline: 'success',
    approvals: { given: 0, required: 2 },
    comments: 0,
    isNew: true,
    workspace: null
  },
  {
    id: 'rr5',
    iid: 3101,
    title: 'Fix timezone drift in delivery calendar',
    project: 'frontend/web-app',
    author: 'mkovac',
    requestedAt: now - 9 * MIN,
    updatedAt: now - 9 * MIN,
    pipeline: 'none',
    approvals: { given: 0, required: 2 },
    comments: 1,
    isNew: true,
    workspace: null
  }
]

export const ended: EndedReviewRequest[] = [
  {
    id: 'e1',
    iid: 465,
    title: 'Retry failed SEPA exports',
    project: 'platform/billing/invoice-service',
    reason: 'approved',
    endedAt: now - 20 * HOUR,
    workspace: 'review/invoice-service-465'
  },
  {
    id: 'e2',
    iid: 1270,
    title: 'Parser: handle rotated scans',
    project: 'logistics/ingest/delivery-notes',
    reason: 'merged',
    endedAt: now - 3 * DAY,
    workspace: 'review/delivery-notes-1270',
    skipped: 'Not removed: 3 uncommitted changes'
  }
]

export const lastRefreshedAt = now - 2 * MIN
