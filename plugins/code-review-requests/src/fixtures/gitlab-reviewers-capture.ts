// A real `GET /projects/:id/merge_requests/:iid/reviewers` answer from gitlab.com (2026-11-16,
// read-only, captured for #22), sanitized by hand: every value is replaced, the shape is kept.
// `created_at` is when the reviewer was added, which is when a Review Request starts waiting.

export const mergeRequestReviewersBody = [
  {
    user: {
      id: 1,
      username: 'me',
      public_email: '',
      name: 'Me',
      state: 'active',
      locked: false,
      avatar_url: 'https://gitlab.example.com/uploads/avatar.png',
      web_url: 'https://gitlab.example.com/me'
    },
    state: 'unreviewed',
    created_at: '2026-11-10T09:54:14.239Z'
  }
]
