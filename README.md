# ide-ux-agentik

> **Version**: `v0.1.0-alpha.1` — see [`CHANGELOG.md`](./CHANGELOG.md) for the
> release notes.

GPU-accelerated IDE for AI coding agents — manage git worktrees and run
Codex / Claude Code / OpenCode / Gemini in per-workspace chat or terminal
sessions.

> **Architecture in one line**: a Node agent runs locally, a Vite/React
> front-end drives it over WebSocket. The agent **spawns the CLI binaries**
> (`codex`, `claude`, …) and streams their JSON events into the UI. **No
> direct API calls** to Anthropic/OpenAI — all the intelligence comes from
> the CLIs installed on your machine.

---

## ⚠ You must install the CLIs yourself

This app is a UI on top of vendor CLIs. **It does not bundle them, does not
download them, and does not call their APIs directly.** Each CLI you want to
use must be installed and authenticated on your computer **before** the app
can talk to it.

If a CLI is missing, the corresponding chat tab simply stays empty / shows
"no remote-agent workspace" until you install and log in.

| CLI            | Used for                | Required? |
| -------------- | ----------------------- | --------- |
| **codex**      | OpenAI Codex chat tab   | optional  |
| **claude**     | Claude Code chat tab    | optional  |
| **opencode**   | OpenCode chat tab       | optional  |
| **gemini**     | Gemini chat tab         | optional  |

Install at least one to get a working chat tab.

---

## Prerequisites

| Tool                      | Version   | Why                                                                                                                                       |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Bun**                   | ≥ 1.2     | Vite front-end, dev scripts. `curl -fsSL https://bun.sh/install \| bash`                                                                  |
| **Node**                  | ≥ 24      | Agent server (`--experimental-strip-types` to read `.ts` natively). Bun does not work for the agent because of a `node-pty` + `codex` bug. |
| **codex CLI**             | latest    | OpenAI Codex chat tab. `npm i -g @openai/codex`, then `codex login`.                                                                       |
| **claude CLI**            | latest    | Claude Code chat tab. See section below.                                                                                                  |
| **opencode** / **gemini** | optional  | Only if you want those tabs too.                                                                                                          |

Again: none of those CLI binaries are required to boot the front-end, but a
chat tab whose binary is missing will simply not work until you install and
authenticate it locally.

---

## Install the Claude Code CLI

```bash
# Official npm package
npm i -g @anthropic-ai/claude-code

# Authentication — two options:
# (a) Interactive OAuth (recommended for Claude.ai Pro/Max subscribers)
claude login
#   → opens a browser auth page, stores tokens in ~/.claude/.credentials.json

# (b) Direct API key
export ANTHROPIC_API_KEY=sk-ant-...
#   → can coexist with OAuth; the API key takes priority when set
```

Verify: `claude --version` then `claude -p "say hi"`.

The app reads `~/.claude/.credentials.json` indirectly through the binary —
you don't have to enter a key in the UI unless you want to override the key
for a specific workspace (Settings → Providers → Claude → API key).

---

## Install the Codex CLI

```bash
npm i -g @openai/codex
codex login   # ChatGPT OAuth (Plus / Pro / Team / Enterprise)
# OR
export OPENAI_API_KEY=sk-...
```

Verify: `codex exec "say hi"`.

Codex OAuth is also manageable from inside the app (Settings → Providers →
Codex → Sign in).

---

## Install OpenCode / Gemini (optional)

Both follow the same pattern: install the official CLI, run its `login`
command (or set its API key env var), and verify with the CLI itself before
opening the matching tab in the app.

```bash
# OpenCode
npm i -g opencode-ai && opencode --version

# Gemini
npm i -g @google/gemini-cli && gemini --version
```

If a tab still does not work, the very first thing to check is that the CLI
itself runs successfully **outside** the app.

---

## Run locally

```bash
bun install
bun run dev
# → front-end on http://localhost:8080
# → agent on   ws://localhost:8090 (auto-spawned by scripts/dev.ts)
```

On the first launch, a `dev-agent` workspace is auto-registered (the project
root). To point at another folder, add a remote-agent workspace from the UI
(`Add workspace → Choose folder from file system…`).

> **Workspace removal safety**: starting with `v0.1.0-alpha.1`, removing a
> workspace whose folder you picked yourself (`Choose folder from file
> system…`) **never deletes that folder from disk**. Only folders the app
> created itself (e.g. GitHub clones) are physically removed on workspace
> deletion. Legacy workspaces with unknown provenance are treated as
> user-selected (safe default).

---

## Tests

```bash
bun run test:e2e           # offline smoke (no agent)
bun run test:e2e:agent     # integration against a Node agent spawned by the spec
bun run test:e2e:ui        # interactive Playwright UI
```

---

## Useful slash commands in the chat tab

| Slash             | Effect                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `/clear`          | Empty the thread and remove persisted messages from SQLite.                                                     |
| `/compact`        | Summarize the conversation via `codex exec --json` (Codex) and replace history with the summary. ~120 s timeout. |
| `/help`           | List available commands.                                                                                        |
| `/reset` / `/new` | Aliases of `/clear`.                                                                                            |

---

## Layout

- `agent/` — Node server (JSON-RPC over WebSocket, CLI spawning, SQLite
  persistence). Contract documented in `agent/server.ts`.
- `src/` — Vite front-end + assistant-ui. Conventions: see `AGENTS.md`
  (workflow) and `CLAUDE.md` (gotchas).
- `e2e/` — Playwright specs.
- `scripts/dev.ts` — dev orchestrator (spawns front + agent in parallel,
  under Node or Bun depending on the component).
- `~/.ide-ux-agentik/data.sqlite` — persisted store (sessions, messages,
  snapshots, content-addressed blobs).

---

## Why no direct Anthropic / OpenAI API?

Conscious choice: the entire tool-harness (shell, read/write/edit, glob,
grep, todowrite, plan, skills, subagents, MCP, …) lives inside the `codex`
and `claude` binaries. Reimplementing it server-side would take months of
work plus permanent maintenance to track CLI changes. By spawning the
binaries we get those capabilities for free — at the cost of an install
dependency that the user must satisfy.

That tradeoff is the whole reason **the CLIs must be installed on your
computer**. The app is the orchestration layer; the CLIs are the engine.
