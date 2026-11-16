// The environment `git` runs with from the plugin worker. Orca's worker env allowlist drops
// SSH_AUTH_SOCK, so an SSH remote can't reach the user's agent unless we restore it.
import { assert, test } from 'orca/testing'
import { gitEnv } from './git-env'

const base = { PATH: '/usr/bin', HOME: '/Users/ada' }

test('restores SSH_AUTH_SOCK from launchd on macOS when the worker env lacks it', async () => {
  const env = await gitEnv(base, 'darwin', async () => '/private/tmp/launchd-1/Listeners')
  assert.equal(env.SSH_AUTH_SOCK, '/private/tmp/launchd-1/Listeners')
  assert.equal(env.PATH, '/usr/bin')
})

test('keeps an SSH_AUTH_SOCK that is already set and does not ask launchd', async () => {
  let asked = false
  const env = await gitEnv({ ...base, SSH_AUTH_SOCK: '/tmp/agent.sock' }, 'darwin', async () => {
    asked = true
    return '/other'
  })
  assert.equal(env.SSH_AUTH_SOCK, '/tmp/agent.sock')
  assert.equal(asked, false)
})

test('does not ask launchd off macOS', async () => {
  let asked = false
  const env = await gitEnv(base, 'linux', async () => {
    asked = true
    return '/x'
  })
  assert.equal(env.SSH_AUTH_SOCK, undefined)
  assert.equal(asked, false)
})

test('leaves SSH_AUTH_SOCK unset when launchd has none or the lookup fails', async () => {
  assert.equal((await gitEnv(base, 'darwin', async () => '')).SSH_AUTH_SOCK, undefined)
  const env = await gitEnv(base, 'darwin', async () => {
    throw new Error('launchctl missing')
  })
  assert.equal(env.SSH_AUTH_SOCK, undefined)
})

test('never prompts: git and ssh fail instead of waiting for input nobody can give', async () => {
  const env = await gitEnv(base, 'linux', async () => '')
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.match(env.GIT_SSH_COMMAND ?? '', /BatchMode=yes/)
})

test('keeps a GIT_SSH_COMMAND the user set', async () => {
  const env = await gitEnv({ ...base, GIT_SSH_COMMAND: 'ssh -i key' }, 'linux', async () => '')
  assert.equal(env.GIT_SSH_COMMAND, 'ssh -i key')
})
