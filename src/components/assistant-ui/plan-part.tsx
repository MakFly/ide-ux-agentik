"use client";

/**
 * PlanStepList — renders a structured plan emitted by Codex via `plan_update`
 * events OR promoted from a markdown response by codex-adapter's parsePlanMarkdown.
 *
 * Codex native event shape (openai/codex-rs/tools/src/plan_tool.rs):
 *   { type: "item.updated", item: { type: "plan_update", explanation?: string,
 *     plan: PlanStep[] } }
 *
 * Markdown-promoted shape (codex-adapter.ts parsePlanMarkdown):
 *   { title?, explanation?, steps: PlanStep[], followUps?: string[] }
 *
 * Mapped by codex-adapter.ts to a tool-call part with toolName "plan".
 * Dispatched to this component by tool-fallback.tsx:254.
 */

import { useMemo } from "react";
import { CheckCircle2, Circle, ListTodo, LoaderCircle, Pencil, Play, Trash2 } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAssistantRuntime } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export type PlanStep = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

export type PlanArgs = {
  title?: string;
  explanation?: string;
  steps: PlanStep[];
  followUps?: string[];
};

function StepIcon({ status }: { status: PlanStep["status"] }) {
  if (status === "completed") return <CheckCircle2 className="size-4 shrink-0 text-green-500" />;
  if (status === "in_progress")
    return <LoaderCircle className="size-4 shrink-0 animate-spin text-blue-500" />;
  return <Circle className="size-4 shrink-0 text-muted-foreground/50" />;
}

export const PlanStepList: ToolCallMessagePartComponent = ({ args }) => {
  const runtime = useAssistantRuntime();
  const { title, explanation, steps = [], followUps = [] } = (args ?? {}) as PlanArgs;

  const { done, total, pct } = useMemo(() => {
    const t = steps.length;
    const d = steps.filter((s) => s.status === "completed").length;
    return { done: d, total: t, pct: t === 0 ? 0 : Math.round((d / t) * 100) };
  }, [steps]);

  function setComposer(text: string) {
    try {
      runtime.thread.composer.setText(text);
    } catch (e) {
      console.warn("[plan] composer.setText failed:", e);
    }
  }

  return (
    <div className="my-1 w-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <ListTodo className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">{title ? `Plan · ${title}` : "Plan"}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </div>

      {/* Progress bar */}
      {total > 0 && <Progress value={pct} className="h-1 rounded-none" />}

      {/* Explanation */}
      {explanation && (
        <p className="px-4 pt-3 text-[13px] leading-5 text-muted-foreground">{explanation}</p>
      )}

      {/* Steps */}
      <ul className="flex flex-col gap-1 px-4 py-3">
        {steps.map((s, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2.5 text-sm leading-5",
              s.status === "completed" && "text-muted-foreground line-through",
            )}
          >
            <StepIcon status={s.status} />
            <span>{s.step}</span>
          </li>
        ))}
      </ul>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
        <Button
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setComposer("Approve the plan above and start executing step 1.")}
        >
          <Play className="size-3.5" />
          Approve &amp; execute
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => setComposer("Refine the plan above — ")}
        >
          <Pencil className="size-3.5" />
          Refine
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-muted-foreground"
          onClick={() => setComposer("Discard the plan above and propose a different approach.")}
        >
          <Trash2 className="size-3.5" />
          Discard
        </Button>
      </div>

      {/* Follow-up suggestions */}
      {followUps.length > 0 && (
        <div className="border-t px-4 py-2.5">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Follow-up suggestions
          </div>
          <div className="flex flex-wrap gap-1.5">
            {followUps.map((f, i) => (
              <Button
                key={i}
                size="sm"
                variant="outline"
                className="h-7 justify-start gap-1.5 whitespace-normal text-left text-[12px] font-normal"
                onClick={() => setComposer(f)}
                title={f}
              >
                {f}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

PlanStepList.displayName = "PlanStepList";
