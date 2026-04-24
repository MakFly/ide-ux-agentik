"use client";

/**
 * PlanStepList — renders a structured plan emitted by Codex via `plan_update` events.
 *
 * Codex event shape (from openai/codex-rs):
 *   { type: "item.updated", item: { type: "plan_update", explanation?: string, plan: PlanStep[] } }
 *
 * Mapped by codex-adapter.ts to a tool-call part with toolName "plan".
 */

import { CheckCircle2, Circle, ListTodo, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export type PlanStep = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

export type PlanArgs = {
  explanation?: string;
  steps: PlanStep[];
};

function StepIcon({ status }: { status: PlanStep["status"] }) {
  if (status === "completed") return <CheckCircle2 className="size-4 shrink-0 text-green-500" />;
  if (status === "in_progress")
    return <LoaderCircle className="size-4 shrink-0 animate-spin text-blue-500" />;
  return <Circle className="size-4 shrink-0 text-muted-foreground/50" />;
}

export const PlanStepList: ToolCallMessagePartComponent = ({ args }) => {
  const { explanation, steps = [] } = (args ?? {}) as PlanArgs;

  return (
    <div className="my-1 rounded-lg border bg-card text-card-foreground shadow-sm w-full">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <ListTodo className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Plan</span>
      </div>
      {explanation && <p className="px-4 pt-3 text-sm text-muted-foreground">{explanation}</p>}
      <ul className="flex flex-col gap-1 px-4 py-3">
        {steps.map((s, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2.5 text-sm",
              s.status === "completed" && "text-muted-foreground line-through",
            )}
          >
            <StepIcon status={s.status} />
            <span className="leading-5">{s.step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

PlanStepList.displayName = "PlanStepList";
