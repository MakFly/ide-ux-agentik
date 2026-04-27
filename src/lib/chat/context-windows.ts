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

function stripClaudeModelSuffix(model: string | undefined): string | undefined {
  return model?.replace(/\[.*\]$/, "");
}

function hasClaudeOneMSuffix(model: string | undefined): boolean {
  return /\[1m\]$/i.test(model ?? "");
}

function hasNativeOneMClaudeContext(model: string | undefined): boolean {
  return stripClaudeModelSuffix(model) === "claude-opus-4-7";
}

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
  const normalizedModel = cli === "claude" ? stripClaudeModelSuffix(model) : model;
  // Explicit override only applies when meaningful for the CLI (Claude).
  if (cli === "claude") {
    if (hasNativeOneMClaudeContext(normalizedModel)) return 1_000 * KB;
    if (override === "200k") return 200 * KB;
    // Auto prefers the largest supported context window for the selected model.
    if (override === "1m" || supportsOneM(cli, normalizedModel)) return 1_000 * KB;
  }
  if (normalizedModel) {
    const key = `${cli}:${normalizedModel}`.toLowerCase();
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
  const normalizedModel = stripClaudeModelSuffix(model);
  if (cli !== "claude") return false;
  if (!normalizedModel) return false;
  if (/^claude-opus-4-\d+$/.test(normalizedModel)) return true;
  if (normalizedModel === "claude-sonnet-4-6") return true;
  return false;
}

/** True when Claude exposes an actual 200K/1M choice instead of native 1M. */
export function supportsContextOverride(cli: TerminalKind, model: string | undefined): boolean {
  const normalizedModel = stripClaudeModelSuffix(model);
  if (cli !== "claude") return false;
  if (!normalizedModel) return false;
  return normalizedModel === "claude-opus-4-6" || normalizedModel === "claude-sonnet-4-6";
}

/**
 * Resolve the actual model id to pass to the Claude CLI.
 *
 * `Auto` now prefers the largest context tier supported by the selected model:
 *   - Opus 4.7 stays native 1M (no suffix)
 *   - Opus 4.6 / Sonnet 4.6 append `[1m]`
 *   - `200k` strips any long-context suffix
 */
export function resolveLaunchModel(
  cli: TerminalKind,
  model: string | undefined,
  override?: ContextOverride,
): string | undefined {
  if (cli !== "claude" || !model) return model;
  const normalizedModel = stripClaudeModelSuffix(model);
  if (!normalizedModel) return model;
  if (override === "200k") return normalizedModel;
  if (!supportsOneM(cli, normalizedModel)) return normalizedModel;
  if (normalizedModel === "claude-opus-4-7") return normalizedModel;
  return `${normalizedModel}[1m]`;
}

/**
 * Runtime logs can lag behind the current Claude picker state.
 *
 * Example: an older Sonnet 4.6 task recorded `200000`, but the agent picker
 * is now on Auto/1M for the same base model. In that case the agent-level
 * status should reflect the active launch config, not the stale task snapshot.
 */
export function getDisplayContextWindow(params: {
  cli: TerminalKind;
  configuredModel: string | undefined;
  runtimeModel?: string;
  runtimeContextWindow?: number;
  override?: ContextOverride;
}): number {
  const configuredMax = getContextWindow(params.cli, params.configuredModel, params.override);
  if (params.runtimeContextWindow === undefined) return configuredMax;
  if (params.cli !== "claude") return params.runtimeContextWindow;
  if (!params.configuredModel) return params.runtimeContextWindow;

  const configuredLaunchModel = resolveLaunchModel(
    params.cli,
    params.configuredModel,
    params.override,
  );
  const configuredBase = stripClaudeModelSuffix(configuredLaunchModel);
  const runtimeBase = stripClaudeModelSuffix(params.runtimeModel);
  if (!configuredBase) return params.runtimeContextWindow;
  if (runtimeBase && runtimeBase !== configuredBase) return configuredMax;
  if (!hasClaudeOneMSuffix(configuredLaunchModel)) return params.runtimeContextWindow;
  if (params.runtimeContextWindow >= 1_000 * KB) return params.runtimeContextWindow;
  if (!runtimeBase || runtimeBase === configuredBase) return configuredMax;
  return params.runtimeContextWindow;
}
