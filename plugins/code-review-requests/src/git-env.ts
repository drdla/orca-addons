// The environment `git` runs with from the plugin worker.
//
// Orca's worker env allowlist (PATH, HOME, LANG, TZ, TMPDIR, …) drops SSH_AUTH_SOCK, so `git fetch`
// over an SSH remote can't reach the user's SSH agent and fails with "Permission denied (publickey)"
// when the key has a passphrase. On macOS the agent socket is published through launchd, so we ask
// `launchctl getenv SSH_AUTH_SOCK` for it. Agents set through `IdentityAgent` in ~/.ssh/config
// (1Password and similar) need nothing from the env and keep working either way.
//
// git and ssh must never prompt: the worker has no terminal, so a prompt would only hang until the
// timeout. GIT_TERMINAL_PROMPT=0 and ssh BatchMode make them fail fast with a readable error.

export type Env = Record<string, string | undefined>

/** Reads launchd's SSH_AUTH_SOCK; resolves '' when it has none. */
export type ReadLaunchdSshAuthSock = () => Promise<string>

export async function gitEnv(
  env: Env,
  platform: string,
  readLaunchdSshAuthSock: ReadLaunchdSshAuthSock
): Promise<Env> {
  const result: Env = {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes'
  }
  if (!env.SSH_AUTH_SOCK && platform === 'darwin') {
    const sock = await readLaunchdSshAuthSock().catch(() => '')
    if (sock.trim() !== '') result.SSH_AUTH_SOCK = sock.trim()
  }
  return result
}
