/**
 * Context window catalogue — per-CLI, per-model.
 *
 * Single source of truth for the dynamic context ring + status popover.
 * Values reflect April 2026 model specs:
 *   - Claude Opus 4.7 → 1M tokens natively (no beta header needed)
 *   - Claude Opus 4.6 / Sonnet 4.6 → 200K default, 1M unlocked via the
 *     `context-1m-2025-08-07` beta header (anthropic-beta). Long-context
 *     pricing (>200K prompts) applies — see Anthropic API release notes.
 *   - Claude Haiku 4.5 → 200K tokens, no 1M tier
 *   - Codex GPT-5.5 → ~400K tokens (conservative estimate)
 *
 * When a CLI/model combination doesn't match a known rule, we fall back to
 * 200K which is the industry-standard baseline.
 */

import type { TerminalKind } from "@/store/ide";

export type ContextOverride = "200k" | "1m" | undefined;

const KB = 1_000;

/** Default context window (tokens) per (cli, model). Keys are lower-cased. */
const DEFAULTS: Record<string, number> = {
  // Claude
  "claude:claude-opus-4-7": 1_000 * KB,
  "claude:claude-opus-4-6": 200 * KB,
  "claude:claude-sonnet-4-6": 200 * KB,
  "claude:claude-sonnet-4-5": 200 * KB,
  "claude:claude-haiku-4-5": 200 * KB,
  // Codex
  "codex:gpt-5.5": 400 * KB,
  "codex:gpt-5.4": 256 * KB,
  "codex:gpt-5.4-mini": 256 * KB,
  "codex:gpt-5.3-codex": 256 * KB,
  "codex:gpt-5.3-codex-spark": 256 * KB,
  "codex:gpt-5.2": 200 * KB,
};

const CLI_FALLBACK: Record<string, number> = {
  codex: 256 * KB,
  claude: 200 * KB,
  opencode: 200 * KB,
  gemini: 1_000 * KB,
};

export function getContextWindow(
  cli: TerminalKind,
  model: string | undefined,
  override?: ContextOverride,
): number {
  // Explicit override only applies when meaningful for the CLI (Claude).
  if (cli === "claude") {
    if (override === "1m") return 1_000 * KB;
    if (override === "200k") return 200 * KB;
  }
  if (model) {
    const key = `${cli}:${model}`.toLowerCase();
    if (DEFAULTS[key]) return DEFAULTS[key];
  }
  return CLI_FALLBACK[cli] ?? 200 * KB;
}

/**
 * True if the active model supports both 200K and 1M context windows.
 * Opus 4.7+ runs 1M natively. Opus 4.6 + Sonnet 4.6 unlock 1M via the
 * `context-1m-2025-08-07` beta header (long-context pricing applies).
 * Haiku 4.5 has no 1M tier.
 */
export function supportsOneM(cli: TerminalKind, model: string | undefined): boolean {
  if (cli !== "claude") return false;
  if (!model) return false;
  if (/^claude-opus-4-\d+$/.test(model)) return true;
  if (model === "claude-sonnet-4-6") return true;
  return false;
}
