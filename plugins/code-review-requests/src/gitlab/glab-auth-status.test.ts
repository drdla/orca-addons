// Reading `glab auth status` (#8): which hosts glab is logged in to, for the setup checklist's
// "Use <host>". The sample follows glab 1.x's output layout (it writes to stderr, no colours
// when not on a terminal); hosts, users and paths are placeholders.
import { assert, test } from 'orca/testing'
import { loggedInHosts } from './glab-auth-status'

const SAMPLE = `gitlab.com
  ✓ Logged in to gitlab.com as someone (/Users/me/.config/glab-cli/config.yml)
  ✓ Git operations for gitlab.com configured to use ssh protocol.
  ✓ API calls for gitlab.com are made over https protocol.
  ✓ REST API Endpoint: https://gitlab.com/api/v4/
  ✓ GraphQL API Endpoint: https://gitlab.com/api/graphql/
  ✓ Token found: **************************
gitlab.example.com
  x gitlab.example.com: API call failed: GET https://gitlab.example.com/api/v4/user: 401 {message: 401 Unauthorized}
  ✓ Git operations for gitlab.example.com configured to use ssh protocol.
git.other.org:8443
  ✓ Logged in to git.other.org:8443 as someone-else (/Users/me/.config/glab-cli/config.yml)
`

test('lists the hosts glab is logged in to, skipping those whose login failed', () => {
  assert.deepEqual(loggedInHosts(SAMPLE), ['gitlab.com', 'git.other.org:8443'])
})

test('colour codes and an empty answer are fine', () => {
  assert.deepEqual(loggedInHosts('\u001b[32m✓\u001b[0m Logged in to gitlab.com as me (config)'), ['gitlab.com'])
  assert.deepEqual(loggedInHosts(''), [])
})
