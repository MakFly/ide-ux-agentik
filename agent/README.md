# ide-ux-agentik — remote agent

Minimal Bun WebSocket agent. Run it on any machine (local dev box, VPS,
cloud VM) and connect your webapp to it as a "Remote workspace".

## Quick start

```bash
# 1. Install Bun if needed — see https://bun.sh
curl -fsSL https://bun.sh/install | bash

# 2. Clone the agent (or just this folder)
git clone <repo> && cd <repo>/agent

# 3. Generate a token
TOKEN=$(openssl rand -hex 24)

# 4. Run the agent rooted on the project you want to edit
bun run server.ts --root ~/code/my-project --port 7421 --token "$TOKEN"

# 5. In the webapp → Add workspace → Remote
#    URL:   ws://<this-machine-ip>:7421
#    Token: (the $TOKEN value above)
```

## Production setup (TLS)

The agent speaks plain WebSocket. For anything beyond localhost, put it
behind nginx/caddy with TLS and connect over `wss://`.

```caddy
# Caddyfile
my-dev.example.com {
    reverse_proxy 127.0.0.1:7421
}
```

Then from the webapp use `wss://my-dev.example.com`.

## SSH-only machines

If your target is behind SSH and has no public port, open a local forward
first:

```bash
# From your laptop
ssh -L 7421:localhost:7421 user@remote -N
# Then run the agent on the remote as usual, and connect from the webapp
# to ws://localhost:7421
```

This is the gap Tauri will eventually close — opening + tunneling this
SSH connection from inside the app.

## Flags

| Flag        | Env              | Default   | Meaning                                 |
|-------------|------------------|-----------|-----------------------------------------|
| `--root`    | `AGENT_ROOT`     | `cwd`     | Directory served as workspace root      |
| `--port`    | `AGENT_PORT`     | `7421`    | TCP port                                |
| `--host`    | `AGENT_HOST`     | `0.0.0.0` | Bind address (use `127.0.0.1` + tunnel) |
| `--token`   | `AGENT_TOKEN`    | —         | Shared secret (required)                |

## Security notes

- The token is sent in the first WS message. If a caller fails to `auth`
  within 5 s, the socket is closed with code `4401`.
- Every path is resolved and asserted to stay inside `--root`. `..` is
  stripped defensively.
- No execution — the agent is read/write filesystem only. Terminal & git
  are not exposed here (deliberate, separate concern).

## Protocol

JSON-RPC 2.0. Methods: `auth`, `ls`, `stat`, `readFile`, `writeFile`,
`mkdir`, `remove`, `rename`, `watch`, `unwatch`. See
`src/lib/fs/remote-agent.ts` for the full spec and payload shapes.
