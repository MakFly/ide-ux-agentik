---
name: agentic-cli-config
description: Keep the project's Claude Code / Codex / Gemini CLI configuration in sync with upstream — model catalogue, effort levels, context windows, beta headers, default flags. Use when the user says "mets à jour les modèles", "refresh CLI config", "y a-t-il un nouveau modèle Claude/Codex", "check effort levels", "context window à jour", "1M beta header", or before any release notes / model launch (Anthropic, OpenAI). Runs WebSearch + fetches official docs, diffs against the current catalogue, and patches the source files.
disable-model-invocation: false
allowed-tools: Read, Edit, Write, Glob, Bash(ig *), Bash(bun *), WebSearch, WebFetch
---

# agentic-cli-config

Single-source-of-truth refresher for everything that depends on **upstream CLI behaviour** (Claude Code, Codex, Gemini). When Anthropic or OpenAI ship a model, change a flag, deprecate a beta header, or move defaults, this project drifts silently. This skill detects the drift and patches it.

## Files this skill owns (the canonical surface)

| File                                            | Owns                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/lib/chat/context-windows.ts`               | `DEFAULTS` map (cli:model → tokens), `CLI_FALLBACK`, `supportsOneM()`          |
| `src/lib/chat/models.ts`                        | `CODEX_MODELS`, `DEFAULT_CODEX_MODEL`, `claudeExtraArgs()`, `codexExtraArgs()` |
| `src/components/ide/model-pill.tsx`             | `CLAUDE_MODELS`, `OPENCODE_MODELS`, `GEMINI_MODELS`, `DEFAULT_BY_CLI`          |
| `src/components/ide/reasoning-pill.tsx`         | `EFFORTS_CLAUDE`, `EFFORTS_CODEX`, `ReasoningEffort` union, `DEFAULT_EFFORT`   |
| `src/lib/chat/claude-adapter.ts`                | `ANTHROPIC_BETAS` env (e.g. `context-1m-2025-08-07`), `--effort` mapping       |
| `src/lib/chat/codex-adapter.ts`                 | `--effort` mapping for codex                                                   |
| `src/components/assistant-ui/status-button.tsx` | Hint copy under the 200K/1M chips                                              |

If a fact lives elsewhere it should be migrated here first.

## Authoritative sources (always check these, in order)

### Claude / Anthropic

1. **Claude Code CLI docs** — https://code.claude.com/docs/en/model-config (effort levels, defaults per model, env vars)
2. **Claude Code release notes** — https://code.claude.com/docs/en/release-notes (look for "v2.x", "default effort", "model rollout")
3. **Anthropic platform release notes** — https://platform.claude.com/docs/en/release-notes/overview (model launches, beta headers, deprecations)
4. **Anthropic models reference** — https://docs.anthropic.com/en/docs/about-claude/models/overview (context windows, ids)
5. **Beta headers index** — https://docs.anthropic.com/en/api/beta-headers (current header names, sunsets — e.g. `context-1m-2025-08-07` retiring on Sonnet 4.5/4 on 2026-04-30)

### Codex / OpenAI

1. **OpenAI Codex CLI repo / README** — https://github.com/openai/codex (flags, model ids, `--effort`)
2. **OpenAI release notes / model index** — https://platform.openai.com/docs/models (gpt-5.x lineup, context windows)

### Gemini

1. **Gemini CLI docs** — https://github.com/google-gemini/gemini-cli
2. **Gemini API model list** — https://ai.google.dev/gemini-api/docs/models

Prefer **WebFetch on these exact URLs** over `WebSearch` — fewer hallucinations, dated content. Use WebSearch only to discover _new_ URLs (release titles, blog posts) and then WebFetch the canonical doc.

## Workflow

### 1. Snapshot the current state

Run, in parallel:

```bash
ig "DEFAULTS|CLI_FALLBACK|supportsOneM" src/lib/chat/context-windows.ts
ig "CLAUDE_MODELS|OPENCODE_MODELS|GEMINI_MODELS|CODEX_MODELS" src/components/ide/model-pill.tsx src/lib/chat/models.ts
ig "EFFORTS_CLAUDE|EFFORTS_CODEX|ReasoningEffort" src/components/ide/reasoning-pill.tsx
ig "ANTHROPIC_BETAS|context-1m" src/lib/chat/
```

Read each match and tabulate (model id, label, tokens, default effort, beta headers).

### 2. Pull upstream truth

Foreach CLI in {claude, codex, gemini}:

- WebFetch the model-config / release-notes URL
- Extract: model ids · context window (input tokens) · default effort · supported `--effort` values · required beta headers · deprecation dates

Cross-check at least **two** of the listed sources before changing a fact. A single blog post is not enough — the canonical doc must agree.

### 3. Diff, then patch

Build a tiny diff table:

```
model              tokens    default-effort   1M?    beta-header
claude-opus-4-7    1_000_000 xhigh            yes    (none, native)
claude-opus-4-6    200_000   high             yes    context-1m-2025-08-07
claude-sonnet-4-6  200_000   high             yes    context-1m-2025-08-07
claude-haiku-4-5   200_000   medium           no     —
gpt-5.5            400_000   high             —      —
```

For each row that differs from the codebase, edit the appropriate file. Never invent values — if the doc is silent, leave the existing value and note it in the report.

### 4. Verify

```bash
bunx tsc --noEmit 2>&1 | grep -E "(context-windows|reasoning-pill|model-pill|claude-adapter|codex-adapter|status-button|models)\.ts" || echo OK
bun run lint 2>&1 | tail -20
```

Then run the relevant Playwright smoke if effort/context UI changed:

```bash
bunx playwright test e2e/smoke.spec.ts -g "model pill\|status"
```

### 5. Report

Output a short summary: what changed, what stayed, what was uncertain (and the URL to confirm later). Cite source URLs.

## Hard rules

- **Never** add a model id that isn't documented on an official Anthropic/OpenAI/Google page. No "claude-opus-5-0" guesses.
- **Never** flip `supportsOneM` on by default for a model unless the doc explicitly lists 1M. Beta-header models stay opt-in.
- **Never** remove an existing model id without checking it's actually deprecated upstream (the user may still pin it). Mark legacy models in the description (`"Legacy · 200K"`) instead.
- **Always** preserve the `claude-adapter.ts` `ANTHROPIC_BETAS` injection when 1M is selected. If Anthropic ships a new beta header (e.g. `context-2m-…`), add it under a new override value — don't overwrite the existing one.
- **Always** keep `EFFORTS_CODEX` capped at the levels Codex actually supports. The defensive `xhigh|max → high` map in `codex-adapter.ts` is the safety net, not a substitute for the right list.
- **Always** update `status-button.tsx` hint copy when the rules change (currently mentions `context-1m-2025-08-07`).

## Quick triggers

| User says                                        | Do                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| "y a-t-il un nouveau Opus / Sonnet / Haiku ?"    | Steps 1→3 for Claude only                                                                  |
| "Codex a sorti gpt-5.6 ?"                        | Steps 1→3 for Codex only                                                                   |
| "refresh CLI config" / "mets à jour les modèles" | Full sweep, all CLIs                                                                       |
| "1M context broken on Sonnet 4.6"                | Confirm beta header in Anthropic docs, verify `supportsOneM` + `ANTHROPIC_BETAS` injection |
| "default effort changed in Claude Code v2.X"     | WebFetch release notes, update `DEFAULT_EFFORT` and per-model defaults                     |

## Out of scope

- Don't touch UI styling, copy unrelated to model facts, or unrelated adapters.
- Don't change `MAX_HISTORY_TURNS` / `MAX_PROMPT_CHARS` — those are project-tuned, not upstream-driven.
- Don't auto-bump to a new major Claude Code CLI version unless the user asks (breaking flags possible).
