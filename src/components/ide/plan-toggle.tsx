"use client";

/**
 * PlanToggle — composer action that enables Plan Mode for Codex.
 *
 * When active, codex-adapter.ts prepends PLAN_MODE_SYSTEM_PREFIX to the prompt
 * so Codex emits structured `plan_update` events before acting.
 *
 * Persisted per-CLI in localStorage["plan-mode-by-cli"].
 */

import { useState } from "react";
import { ListTodo } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TerminalKind } from "@/store/ide";

const STORAGE_KEY = "plan-mode-by-cli";

function readStore(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function usePlanMode(cli: TerminalKind): [boolean, (v: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    return readStore()[cli] ?? false;
  });

  function setValue(v: boolean) {
    const next = { ...readStore(), [cli]: v };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setEnabledState(v);
  }

  return [enabled, setValue];
}

export function PlanToggle({ cli }: { cli: TerminalKind }) {
  const [enabled, setEnabled] = usePlanMode(cli);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={enabled}
          onPressedChange={setEnabled}
          aria-label="Toggle Plan Mode"
          className={cn(
            "h-8 w-8 p-0",
            enabled && "text-blue-500 bg-blue-500/10 hover:bg-blue-500/20",
          )}
        >
          <ListTodo className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="top">
        {enabled ? "Plan Mode on — Codex will outline steps first" : "Enable Plan Mode"}
      </TooltipContent>
    </Tooltip>
  );
}
