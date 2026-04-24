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

## Codex login (device-code flow)

To authenticate Codex from the webapp, use **`codex login --device-auth`** exclusively.
Never use plain `codex login` — it opens an interactive browser redirect that does not
work reliably inside a PTY.

The device-code flow prints a URL and a short code into the PTY. The user opens the
URL in their browser, enters the code, and the CLI receives an OAuth token.

The webapp exposes this as a menu entry: **CLI tab bar → + → Login Codex (device-code)**.
A Sonner toast confirms the flow started; instructions appear directly in the terminal panel.

### OPENAI_API_KEY bypass

If an `OPENAI_API_KEY` is configured in **Settings → Codex**, the webapp injects it as
`env.OPENAI_API_KEY` when spawning any PTY session. This bypasses the OAuth flow
entirely — useful for CI or when you already have a key.

## Security notes

- The token is sent in the first WS message. If a caller fails to `auth`
  within 5 s, the socket is closed with code `4401`.
- Every path is resolved and asserted to stay inside `--root`. `..` is
  stripped defensively.
- The `OPENAI_API_KEY` is passed as a PTY env var and is never logged by the agent.
  Rotate it in the webapp Settings panel if compromised.

## Protocol

JSON-RPC 2.0. First message must be `auth`. All paths are relative to `--root`.

### Filesystem methods

`auth`, `ls`, `stat`, `readFile`, `writeFile`, `mkdir`, `remove`, `rename`,
`watch`, `unwatch`. See `src/lib/fs/remote-agent.ts` for the full spec and payload shapes.

### PTY methods

All PTY calls require a prior `auth`. PTY sessions are automatically killed when the WebSocket closes.

#### `pty.spawn` → `{ id: string }`

Spawn a PTY session. Returns a unique session `id`.

```json
{
  "cmd":  "bash",          // optional — defaults to $SHELL or /bin/bash
  "args": ["-il"],         // optional — defaults to ["-il"] when cmd is omitted
  "cwd":  "src/",          // optional — relative to --root; clamped to root on escape
  "env":  { "FOO": "bar" }, // optional — merged over process.env
  "cols": 220,             // optional — terminal width (default 80)
  "rows": 50               // optional — terminal height (default 24)
}
```

#### `pty.write` → `{ ok: true }`

Send stdin to a session.

```json
{ "id": "<uuid>", "data": "ls -la\r" }
```

#### `pty.resize` → `{ ok: true }`

Resize the PTY (e.g. on xterm resize event).

```json
{ "id": "<uuid>", "cols": 220, "rows": 50 }
```

#### `pty.kill` → `{ ok: true }`

Kill a session.

```json
{ "id": "<uuid>", "signal": "SIGTERM" }
```

#### `pty.list` → `{ sessions: [{id, cmd, cwd, alive}] }`

List all active PTY sessions (useful for debugging).

### Server push notifications

The server sends these over the same WebSocket (no `id` field — they are notifications, not responses):

```json
{ "jsonrpc": "2.0", "method": "pty.data", "params": { "id": "<uuid>", "data": "<utf8 output>" } }
{ "jsonrpc": "2.0", "method": "pty.exit", "params": { "id": "<uuid>", "code": 0, "signal": null } }
```
