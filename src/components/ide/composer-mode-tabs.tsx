import { useState, useCallback } from "react";
import { Monitor, GitBranch, Cloud } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useIDE } from "@/store/ide";

type ExecutionMode = "local" | "worktree" | "cloud";

const STORAGE_KEY = "execution-mode-by-workspace";

function readStorage(): Record<string, ExecutionMode> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeStorage(map: Record<string, ExecutionMode>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function useExecutionMode(workspaceId: string): [ExecutionMode, (v: ExecutionMode) => void] {
  const [map, setMap] = useState<Record<string, ExecutionMode>>(readStorage);
  const value: ExecutionMode = map[workspaceId] ?? "local";

  const setValue = useCallback(
    (next: ExecutionMode) => {
      setMap((prev) => {
        const updated = { ...prev, [workspaceId]: next };
        writeStorage(updated);
        return updated;
      });
    },
    [workspaceId],
  );

  return [value, setValue];
}

type TabDef = {
  id: ExecutionMode;
  label: string;
  icon: React.ElementType;
  disabled?: boolean;
  tooltip?: string;
};

const TABS: TabDef[] = [
  { id: "local", label: "Local", icon: Monitor },
  { id: "worktree", label: "Worktree", icon: GitBranch, disabled: true, tooltip: "Coming soon" },
  {
    id: "cloud",
    label: "Cloud",
    icon: Cloud,
    disabled: true,
    tooltip: "Cloud execution coming soon",
  },
];

export function ComposerModeTabs() {
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const [mode, setMode] = useExecutionMode(activeWorkspaceId);

  return (
    <div className="flex h-8 items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
      {TABS.map(({ id, label, icon: Icon, disabled, tooltip }) => {
        const active = mode === id && !disabled;
        const btn = (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setMode(id)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        );

        if (tooltip) {
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          );
        }

        return btn;
      })}
    </div>
  );
}
