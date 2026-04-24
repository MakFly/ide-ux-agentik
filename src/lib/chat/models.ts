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
  { id: "gpt-5.5",             label: "GPT-5.5",         description: "Frontier · newest (recommended)" },
  { id: "gpt-5.4",             label: "GPT-5.4",         description: "Flagship frontier" },
  { id: "gpt-5.4-mini",        label: "GPT-5.4 mini",    description: "Fast & cheap, subagent-friendly" },
  { id: "gpt-5.3-codex",       label: "GPT-5.3 Codex",   description: "Industry-leading coding" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Spark",   description: "Text-only preview (Pro)" },
  { id: "gpt-5.2",             label: "GPT-5.2",         description: "Previous general-purpose" },
] as const;

export const DEFAULT_CODEX_MODEL = "gpt-5.5";

export function codexExtraArgs(model: string | undefined): string[] | undefined {
  return model ? ["--model", model] : undefined;
}
