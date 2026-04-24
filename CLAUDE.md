# CLAUDE.md — Project gotchas & non-obvious facts

> Companion to AGENTS.md (workflow / tooling rules). This file = things you only
> learn by debugging. Keep it short. Append only when a non-obvious issue cost
> time to resolve.

## assistant-ui — `turnAnchor="top"` disables autoScroll

In `@assistant-ui/react` (v0.12.x), setting `turnAnchor="top"` on
`<ThreadPrimitive.Viewport>` **disables auto-scroll completely**.

Source — `node_modules/@assistant-ui/react/dist/primitives/thread/useThreadViewportAutoScroll.js`:

```js
autoScroll = threadViewportStore.getState().turnAnchor !== "top";
```

Consequence: new messages never bring themselves into view. The composer stays
stuck at its previous scroll position. UX looks like "my message disappeared"
because it landed below the fold.

**Fix**: omit `turnAnchor` on the Viewport. Default behavior is stick-to-bottom
(ChatGPT / Copilot style), which is what we want for the Chat tab.

Repro / verification: `src/components/assistant-ui/thread.tsx` — search for the
comment "No `turnAnchor=\"top\"`".

## Agent runs on Node (not Bun) for PTY reliability

`node-pty` + codex has a broken PTY handshake under Bun: `codex` exits
immediately with `SIGHUP` / 0 bytes output. Under Node it works correctly.

Our `scripts/dev.ts` spawns the agent with
`node --experimental-strip-types --no-warnings agent/server.ts` precisely for
this reason. Don't "simplify" it back to `bun run agent/server.ts` without
re-testing codex end-to-end.

## Mode toggle Chat ↔ Terminal must not unmount the panels

In `src/components/ide/agent-session-view.tsx`, both `<ChatView>` and
`<PtyTerminal>` are mounted at the same time; only the inactive one is `hidden`
via CSS. Conditional rendering (`mode === "chat" ? … : …`) destroys the
assistant-ui runtime on every toggle → conversation vanishes. Same story for
the PTY (session would re-spawn each toggle).

## TypeScript-stripping note

Node 24 reads `.ts` files natively via `--experimental-strip-types`. But
`agent/` is NOT included in `tsconfig.json` (`"include": ["src/**/*.ts", …]`),
so TS errors inside `agent/*` won't be caught by `bunx tsc --noEmit`. Always
run the agent against a real WebSocket client (e.g. the `/team-review` e2e
integration spec) to catch regressions.

## Agent chat RPC — forbidden to passthrough `process.env`

`agent/server.ts` uses a `safeEnv()` allowlist (`PATH, HOME, USER, LANG,
LC_ALL, TERM, SHELL, TMPDIR, LOGNAME, PWD, HOSTNAME`). Secrets like
`OPENAI_API_KEY`, `AWS_*`, `GITHUB_TOKEN`, etc. must be passed EXPLICITLY
by the client via the `env` RPC param. Don't "just merge process.env" — it
leaks every secret of the agent host to every spawned CLI.

Also: `chat.spawn` validates `extraArgs` against a per-CLI allowlist
(`ALLOWED_CHAT_FLAGS`). Only documented flags are accepted.

## Chat history — bounded window

`src/lib/chat/codex-adapter.ts` caps at `MAX_HISTORY_TURNS = 6` and
`MAX_PROMPT_CHARS = 40_000`. Codex `exec --json` doesn't maintain session
state — we resend the transcript each turn. Without the cap, cost grows
O(N²) in tokens. v2 plan is to move to the Codex App Server (native sessions).

## Zustand `onRehydrateStorage` — no binding access inside

`persist()` fires `onRehydrateStorage` **during** `create(...)`'s execution,
inside the TDZ of `const useIDE = create(...)`. Referencing `useIDE` there
throws `ReferenceError: Cannot access 'useIDE' before initialization`, the
store ends up half-initialized, and nothing downstream (hydrate, rehydrate
callbacks) runs. Zustand silently logs the error — you just see a blank UI.

Pattern in `src/store/ide.ts`:

```ts
onRehydrateStorage: () => (state, error) => {
  if (error) return;
  setTimeout(() => void state?.hydrateSessionsFromDb(), 0);
},
```

Use the `state` snapshot passed to the callback (it carries actions), defer
one tick with `setTimeout(..., 0)` so the const binding is wired before
anyone calls `useIDE` directly.

## Persistence RPCs must forward client-supplied `id`

The DB uses `WorkspaceTerminal.id` (client-side) as the `sessions.id` PK so
that `messages.append(sessionId, ...)` keys into the right row. If the RPC
handler in `agent/server.ts` forgets to destructure `id` from params, the
DAO falls back to `randomUUID()` → every subsequent `messages.append` fails
the `session_id` FK silently (because `codex-adapter.ts` used to swallow
errors via `.catch(() => {})`). `sessions.create` uses `INSERT OR IGNORE`
so a repeat create with the same `id` is a safe no-op.

Symptom: refresh loses the transcript, no entries in
`~/.ide-ux-agentik/data.sqlite`, no visible error. Fix: verify the server
handler destructures + forwards `id`, and keep `console.debug` /
`console.warn` logs around every persistence RPC call.

## Kill session = delete DB row too

`closeAgentSession` in `src/store/ide.ts` only mutates the in-memory store.
If the kill flow does not also call `persistence.sessions.delete(id)`, the
row survives in SQLite and `hydrateSessionsFromDb` brings it back on every
refresh. `FOREIGN KEY ON DELETE CASCADE` on `messages` and `file_snapshots`
takes care of the transcript + snapshots, so the delete is single-call.

`src/components/ide/kill-session-dialog.tsx` is the owner of this
orchestration (UI layer, not the store — the store has no provider handle).

## Playwright webserver — dedicated port 8099

`playwright.config.ts` uses `bunx vite dev --port 8099 --strictPort` with
`reuseExistingServer: false`. Reason: in dev, `localhost:8080` can be busy
with the user's own `bun run dev` session (which auto-registers a dev agent
workspace via `src/lib/dev-bootstrap.ts`), contaminating the offline smoke
suite. Dedicated port + never-reuse keeps the e2e deterministic.
