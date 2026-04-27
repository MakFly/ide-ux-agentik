/**
 * Shared Plan Mode plumbing — applied identically to every CLI adapter
 * (codex, claude, …) so toggling Plan Mode in the UI behaves consistently
 * regardless of the active backend.
 *
 * Two pieces:
 *  - PLAN_MODE_SYSTEM_PREFIX: hardened system prompt prefix (verbatim from
 *    Piebald-AI's Claude Code system-prompts, agent-prompt-plan-mode-enhanced.md,
 *    Claude Code v2.1.119, 2026-04-23).
 *  - parsePlanMarkdown: parses the enforced markdown response into a structured
 *    plan so the UI can render PlanStepList instead of a wall of text when the
 *    underlying CLI doesn't emit a native plan tool event.
 */

export const PLAN_MODE_SYSTEM_PREFIX = `PLAN MODE — output a plan proposal, NOT an implementation.

Hard rules for this turn (non-negotiable):
- Do NOT run any tool. No shell, no ls, no grep, no cat, no file reads, no git, no web search.
- Do NOT open, edit, create, delete or move files.
- Do NOT ask clarifying questions.
- Reply with ONE single agent message using the exact markdown format below, then stop.
- Base the plan on the user's description and any context already present in the prompt history; do not try to verify assumptions by exploring.

Required output — use EXACTLY this structure, nothing before, nothing after, no other headers:

## Plan: <one-line title of the plan>

<optional 1-2 sentence context about what you will do>

- [ ] Step 1: <imperative step title> — <short rationale>
- [ ] Step 2: <imperative step title> — <short rationale>
- [ ] Step 3: <imperative step title> — <short rationale>
(aim for 3 to 8 steps; each must start with "- [ ] " and be a single line)

## Follow-up
- <short refinement suggestion the user could ask for>
- <another refinement suggestion>
- <another refinement suggestion>
(3 to 5 items; each a single line, no markdown formatting inside)

Do NOT add a "Critical Files", "Analysis", "Context" or any other extra section. Do NOT prefix steps with numbers — the "- [ ]" prefix is mandatory.`;

const PLAN_MODE_SEPARATOR = "\n\n--- USER REQUEST ---\n";
export const PLAN_MODE_STORAGE_KEY = "plan-mode-by-cli";

function readPlanModeStore(): Record<string, boolean> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PLAN_MODE_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function isPlanApprovalPrompt(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return (
    /^approve\b/.test(normalized) ||
    /^execute\b/.test(normalized) ||
    normalized.includes("approve the plan") ||
    normalized.includes("start executing")
  );
}

export function applyPlanModePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.startsWith(PLAN_MODE_SYSTEM_PREFIX) || isPlanApprovalPrompt(trimmed)) {
    return prompt;
  }
  return `${PLAN_MODE_SYSTEM_PREFIX}${PLAN_MODE_SEPARATOR}${trimmed}`;
}

export function stripPlanModePrompt(prompt: string): string {
  if (!prompt.startsWith(PLAN_MODE_SYSTEM_PREFIX)) return prompt;
  const [, userRequest] = prompt.split(PLAN_MODE_SEPARATOR);
  return userRequest?.trim() || prompt;
}

export type ParsedPlan = {
  title?: string;
  explanation?: string;
  steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
  followUps: string[];
};

export function parsePlanMarkdown(text: string): ParsedPlan | null {
  if (!text) return null;
  const planMatch = text.match(/##\s*Plan(?::\s*(.+?))?\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!planMatch) return null;
  const title = planMatch[1]?.trim() || undefined;
  const planBody = planMatch[2] ?? "";

  const steps: ParsedPlan["steps"] = [];
  const explanationLines: string[] = [];
  let sawStep = false;
  for (const raw of planBody.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const checkbox = line.match(/^[-*]\s*\[( |x|X|~)\]\s*(.+)$/);
    if (checkbox) {
      sawStep = true;
      const marker = checkbox[1];
      const status =
        marker === "x" || marker === "X"
          ? ("completed" as const)
          : marker === "~"
            ? ("in_progress" as const)
            : ("pending" as const);
      steps.push({ step: checkbox[2].trim(), status });
    } else if (!sawStep) {
      explanationLines.push(line);
    }
  }
  if (steps.length === 0) return null;

  const followMatch = text.match(/##\s*Follow[-\s]?up[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  const followUps: string[] = [];
  if (followMatch) {
    for (const raw of followMatch[1].split(/\r?\n/)) {
      const m = raw.match(/^\s*[-*]\s+(.+)$/);
      if (m) followUps.push(m[1].trim());
    }
  }

  return {
    title,
    explanation: explanationLines.length ? explanationLines.join(" ") : undefined,
    steps,
    followUps,
  };
}

export function isPlanModeOn(cli: "codex" | "claude" | "opencode" | "gemini"): boolean {
  return readPlanModeStore()[cli] === true;
}

export function setPlanModeForCli(
  cli: "codex" | "claude" | "opencode" | "gemini",
  enabled: boolean,
): void {
  if (typeof localStorage === "undefined") return;
  const next = { ...readPlanModeStore(), [cli]: enabled };
  localStorage.setItem(PLAN_MODE_STORAGE_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plan-mode-change", { detail: { cli, enabled } }));
  }
}
