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

## assistant-ui reasoning — Codex interim `agent_message` is the visible reasoning

Symptom: after sending a task message, the UI shows normal assistant text/tool
cards but no ChatGPT-style `Reasoning` block, even though
`<MessagePrimitive.Parts>` is configured with `Reasoning` and
`ReasoningGroup`.

Root cause: Codex `exec --json` does not always emit explicit text
`{ "type": "reasoning" }` events. For these local task runs it emits:

```json
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Je vérifie ..."}}
{"type":"item.started","item":{"id":"...","type":"web_search"}}
{"type":"item.completed","item":{"id":"item_5","type":"agent_message","text":"Final answer ..."}}
{"type":"turn.completed","usage":{"reasoning_output_tokens":252}}
```

`reasoning_output_tokens` proves hidden reasoning happened, but it is not
renderable text. The renderable "thinking/status" text is the interim
`agent_message` before tools or before the final answer. If we render every
`agent_message` as assistant text, the reasoning block never appears.

Fix lives in `src/components/ide/Workspace.tsx`:

- `buildTaskThreadMessages` owns the conversion from SQLite task logs to
  assistant-ui `ThreadMessageLike[]`.
- Detect completed `assistant_message` / `agent_message` items per turn.
- Treat every completed agent message except the last one in that turn as a
  `type: "reasoning"` part.
- Keep the last completed agent message as the final assistant `type: "text"`
  part.

`src/components/assistant-ui/reasoning.tsx` should keep
`<ReasoningRoot defaultOpen>` so this visible reasoning/status text appears
immediately, matching the expected UI.

Debugging path that proved it:

```sh
sqlite3 ~/.ide-ux-agentik/data.sqlite \
  "select id, session_id, title, cli, model, effort, status from tasks order by created_at desc limit 10;"

sqlite3 ~/.ide-ux-agentik/data.sqlite \
  "select task_id, ts, source, substr(data_json,1,500) from task_logs order by id desc limit 30;"
```

Then reload the exact thread in the in-app browser and inspect DOM/screenshot.
The expected DOM includes a `button "Reasoning" [expanded]` followed by the
interim agent message. Example verified on thread
`c8250517-3fce-4d95-8cc1-a24e87b5f62f`: `Je vérifie la météo actuelle...`
appeared inside the `Reasoning` block, while the weather answer stayed as the
final assistant text.

Related URL gotcha: `?thread=<sessionId>` must hydrate tasks before
`setActiveThread(thread)`. Without that, refresh sets an active session id
before `tasksByWorkspaceId` contains the backing task, `useActiveAgentThread()`
returns `null`, and the page falls back to the empty "New Agent" composer.
The fix is in `src/components/ide/ide-shell.tsx`: call `hydrateTasks` for the
resolved workspace before applying the `thread` query param.

## Claude Code output — Ctrl+O is reconstructed from tool events

Claude Code does not expose the native Ctrl+O panel as a separate API. In
`--output-format stream-json --include-partial-messages`, the equivalent
renderable data is split across:

- `stream_event.content_block_start` with `content_block.type: "tool_use"`:
  starts a running tool card (`Bash`, `Glob`, `Task`, `TodoWrite`, etc.).
- `stream_event.content_block_delta` with `delta.type: "input_json_delta"`:
  incrementally fills the tool input, e.g. the Bash command.
- assistant messages with `content[].type: "tool_use"`: final normalized tool
  name/input for the same tool id.
- user messages with `content[].type: "tool_result"`: output for
  `tool_use_id`.

`src/components/ide/Workspace.tsx` must therefore map Claude tool events to
assistant-ui `type: "tool-call"` parts and patch the same `toolCallId` when the
matching `tool_result` arrives. Do not pass `tool_result.content` through
`textFromContent` for user messages; that creates fake user bubbles like
`(Bash completed with no output)` or giant Glob outputs.

`src/components/assistant-ui/tool-fallback.tsx` renders the resulting cards. For
shell tools, show the input as `Command`; for non-shell tools, show the JSON
input as `Input`, and the result as `Output`. This gives the web thread the same
useful information Claude Code shows in Ctrl+O without depending on terminal UI
state.

If Claude only emits a `thinking` content block with an empty `thinking` string
and a signature, do not synthesize a persisted `reasoning` block. That is not
readable reasoning. During a live run, `src/components/assistant-ui/thinking-indicator.tsx`
shows a generic looping `Working (Ns)` / `Running <tool>` status; once the run is
done, the real durable trace is the tool cards plus final text.

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

## SQLite table-recreate migration — three traps

Recreating a table to change constraints (e.g. `session_id NOT NULL UNIQUE`) via
the standard `CREATE tasks_new ; INSERT … ; DROP ; RENAME` pattern in
`agent/persistence/db.ts` requires three things together. Skipping any one
fails:

1. **`PRAGMA foreign_keys = OFF` BEFORE the transaction**, not inside (SQLite
   forbids toggling FKs mid-tx). Re-enable in `finally` and run
   `PRAGMA foreign_key_check` to verify integrity before considering the
   migration done.
2. **Explicit column list** in `INSERT INTO new (col1, col2, …) SELECT …`. Never
   `SELECT *`. Old tables that had columns added via `ALTER TABLE` (here:
   `model`, `effort`) carry those columns at the END of the table, while the
   new schema places them mid-row. Positional `*` silently misaligns values
   into wrong columns → FK + UNIQUE violations.
3. **Manual sweep of dependent tables**. With FKs OFF, `ON DELETE CASCADE` does
   NOT fire when you `DROP TABLE tasks`. Orphaned `task_logs`/`messages`/etc.
   rows survive and trip `foreign_key_check` after re-enabling. Run
   `DELETE FROM task_logs WHERE task_id NOT IN (SELECT id FROM tasks)` for
   every child table.

Symptom of trap #2 (the silent one): `foreign_key_check` reports violations on
rows that look fine in `tasks_new` because the value in `session_id` is
actually the old table's `created_at` integer cast to text.

## Playwright webserver — dedicated port 8099

`playwright.config.ts` uses `bunx vite dev --port 8099 --strictPort` with
`reuseExistingServer: false`. Reason: in dev, `localhost:8080` can be busy
with the user's own `bun run dev` session (which auto-registers a dev agent
workspace via `src/lib/dev-bootstrap.ts`), contaminating the offline smoke
suite. Dedicated port + never-reuse keeps the e2e deterministic.
