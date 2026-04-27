"use client";

/**
 * PlanToggle — composer action that enables Plan Mode for the active CLI.
 *
 * When active, the task adapter prepends PLAN_MODE_SYSTEM_PREFIX to the prompt
 * so the active CLI emits a plan before acting.
 *
 * Persisted per-CLI in localStorage["plan-mode-by-cli"].
 */

import { useEffect, useState } from "react";
import { ListTodo } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TerminalKind } from "@/store/ide";
import { PLAN_MODE_STORAGE_KEY, setPlanModeForCli } from "@/lib/chat/plan-mode";

function readStore(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PLAN_MODE_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function usePlanMode(cli: TerminalKind): [boolean, (v: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    return readStore()[cli] ?? false;
  });

  useEffect(() => {
    const sync = () => setEnabledState(readStore()[cli] ?? false);
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("plan-mode-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("plan-mode-change", sync);
    };
  }, [cli]);

  function setValue(v: boolean) {
    setPlanModeForCli(cli, v);
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
        {enabled ? "Plan Mode on — the agent will outline steps first" : "Enable Plan Mode"}
      </TooltipContent>
    </Tooltip>
  );
}
