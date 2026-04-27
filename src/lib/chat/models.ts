/**
 * Codex model catalogue.
 *
 * Source: https://developers.openai.com/codex/models (April 2026)
 * --model / -m flag contract: https://developers.openai.com/codex/cli/reference
 *   "--model, -m | string | Override the model set in configuration"
 *
 * When no model is selected, the flag is omitted and codex falls back to its
 * own recommended default ("start with gpt-5.5 when it appears in your model
 * picker").
 */

export type CodexModel = {
  id: string;
  label: string;
  description: string;
};

export const CODEX_MODELS: readonly CodexModel[] = [
  { id: "gpt-5.5", label: "GPT-5.5", description: "Frontier · newest (recommended)" },
  { id: "gpt-5.4", label: "GPT-5.4", description: "Flagship frontier" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Fast & cheap, subagent-friendly" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Industry-leading coding" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Spark", description: "Text-only preview (Pro)" },
  { id: "gpt-5.2", label: "GPT-5.2", description: "Previous general-purpose" },
] as const;

export const DEFAULT_CODEX_MODEL = "gpt-5.5";

export function codexExtraArgs(model: string | undefined): string[] | undefined {
  return model ? ["--model", model] : undefined;
}

/**
 * Claude CLI model catalogue.
 *
 * Source: https://docs.claude.com/en/docs/build-with-claude/overview (April 2026)
 * `--model` accepts either a model id or a family alias like `opus`/`sonnet`/`haiku`
 * for the current latest in each family.
 */
export type ClaudeModel = {
  id: string;
  label: string;
  description: string;
};

// Source of truth — also consumed by `src/components/ide/model-pill.tsx`.
// Effort & 1M context support per model:
//   https://code.claude.com/docs/en/model-config
//   - Opus 4.7  : 1M native, effort = low|medium|high|xhigh|max (default xhigh)
//   - Opus 4.6  : 200K default, 1M via [1m] suffix · effort = low|medium|high|max
//   - Sonnet 4.6: 200K default, 1M via [1m] suffix · effort = low|medium|high|max
//   - Sonnet 4.5: 200K only · no effort
//   - Haiku 4.5 : 200K only · no effort
export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Frontier · 1M context native · default xhigh",
  },
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Previous flagship · 200K · 1M via [1m] suffix",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Workhorse · 200K · 1M via [1m] suffix",
  },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", description: "Legacy · 200K only" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "Fast & cheap · 200K · no effort" },
] as const;

export const DEFAULT_CLAUDE_MODEL = "claude-opus-4-7";

export function claudeExtraArgs(model: string | undefined): string[] | undefined {
  return model ? ["--model", model] : undefined;
}
