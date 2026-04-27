# AGENTS.md

## Language
- French for discussion.
- English for code, identifiers, commit messages, and config keys.

## Search Tools
- Code search: prefer `ig` over `rg`, `grep`, or generic grep tools.
- Usage: `ig "pattern" [path]` or `ig search "pattern" [path]`.
- Project overview: read `.ig/context.md` before broad exploration.
- Smart read: `ig read <file> --signatures` for imports and signatures.
- Smart summary: `ig smart [path]` for 2-line summaries.
- Fall back to `rg` only if `ig` is unavailable.

## Package Manager
- For JS and TS work, use `bun` and `bunx`.
- Do not use `npm`, `npx`, `pnpm`, or `yarn` unless the repo clearly requires it.

## Agent Thread Reasoning UI
- The chat surface is `src/components/assistant-ui/thread.tsx`, but task-log to assistant-ui message conversion is owned by `src/components/ide/Workspace.tsx`.
- If a reasoning block is missing, first inspect `~/.ide-ux-agentik/data.sqlite` `task_logs.data_json` for the active task. Do not assume the CLI emits assistant-ui `type: "reasoning"` parts.
- Codex `exec --json` can report hidden reasoning only in usage (`reasoning_output_tokens`) while emitting interim `item.completed` `agent_message` entries such as "I will check...". In the UI, those interim `agent_message` entries should map to assistant-ui `type: "reasoning"` parts; only the last `agent_message` in a turn should render as final assistant text.
- Claude Code's native Ctrl+O-style execution output is reconstructed from `stream-json`: map assistant `tool_use` / `input_json_delta` to assistant-ui `type: "tool-call"` parts and patch them with user `tool_result` output. Do not render Claude `tool_result` events as user chat bubbles, and do not create fake `reasoning` parts when Claude only sends a thinking signature.
- `ReasoningGroup` lives in `src/components/assistant-ui/reasoning.tsx`. Keep the block open by default so the user sees the model's visible analysis/status text immediately after sending.
- URLs with `?thread=<sessionId>` must hydrate tasks before calling `setActiveThread`; otherwise refresh can fall back to the empty "New Agent" composer even though the thread exists in SQLite.

## Delegation
- Prefer custom subagents for parallelizable work instead of overloading the main thread.
- Delegate automatically when the request semantically matches a specialized subagent, even if the user does not mention the subagent by name.
- Use `explorer` or `explorer_fast` automatically for broad mapping, call-site discovery, and multi-file search.
- Use `code-mapper` automatically when the parent agent needs a high-confidence execution path and ownership map before changing code.
- Use `reviewer` automatically after non-trivial edits, when reviewing a diff, and before concluding implementation work that changed behavior.
- Use `security-auditor` automatically for auth, secrets, input handling, and security-sensitive config or infra review.
- Use `debugger` automatically for bug reports, regressions, flaky behavior, unexplained failures, or investigation-first debugging.
- Use `error-detective` automatically when the starting point is logs, exceptions, or stack traces.
- Use `test-automator` automatically after a bug fix or any meaningful behavior change that lacks regression coverage.
- Use `frontend-developer` for scoped UI implementation and `ui-fixer` for reproduced UI issues that need the smallest safe patch.
- Use `backend-developer` for scoped backend changes once the owning path is known.
- Use `devops_ops` automatically for CI, Wrangler, Cloudflare, deployment, Docker, workflows, and infra configuration.
- Use `docs-researcher` automatically for API or framework verification, version-specific behavior, "latest" questions, and OpenAI/Codex docs lookups.
- If more than one subagent applies, spawn the smallest useful set in parallel without waiting for the user to explicitly request delegation.
- Keep `max_depth` low and avoid recursive fan-out unless the task truly needs it.
- Do not assign overlapping write ownership to multiple subagents.

## Auto-Trigger Heuristics
- Question looks like exploration only: spawn `explorer` first.
- If the task needs a precise ownership/execution trace before edits, spawn `code-mapper` first.
- User reports a bug or broken behavior: spawn `debugger` first; if the evidence source is mostly logs, use `error-detective`; add `test-automator` after the root cause is known or the fix lands.
- Task involves substantial edits: run `reviewer` before finalizing and add `security-auditor` when the path touches auth, secrets, or exposed inputs.
- Task depends on official or current docs: use `docs-researcher` before assuming behavior.
- Task touches deployment or CI files: route to `devops_ops`.
- For mixed tasks, keep the critical path local and delegate side investigations in parallel.

## Docs And Web Search
- For OpenAI and Codex questions, use the OpenAI developer docs MCP server first.
- Use web search only when information is current, volatile, or missing from MCP/docs.
- Default to cached web search; use live web search only for latest or date-sensitive facts.

## Safety
- Never auto-push.
- Never use destructive git commands without explicit confirmation.
- Never hardcode secrets or print credentials in logs.

## Verification
- Before closing substantial code work, run the narrowest relevant validation first.
- For this repo, prefer relevant combinations of:
  - `bun test`
  - `bunx tsc --noEmit`
  - `bunx eslint .`
