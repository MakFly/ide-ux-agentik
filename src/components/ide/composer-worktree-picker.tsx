import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIDE, useProjectWorktrees, type Worktree } from "@/store/ide";
import { cn } from "@/lib/utils";

const LS_KEY = "worktree-by-workspace";

function loadSelection(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSelection(workspaceId: string, worktreeId: string) {
  const map = loadSelection();
  map[workspaceId] = worktreeId;
  localStorage.setItem(LS_KEY, JSON.stringify(map));
}

function truncatePath(p: string, max = 32): string {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}

export function ComposerWorktreePicker() {
  const [open, setOpen] = useState(false);
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const worktrees = useProjectWorktrees();

  const storedId = loadSelection()[workspaceId];
  const selected: Worktree | undefined = worktrees.find((wt) => wt.id === storedId) ?? worktrees[0];

  function handleSelect(wt: Worktree) {
    saveSelection(workspaceId, wt.id);
    setOpen(false);
  }

  return (
    <TooltipProvider delayDuration={400}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <GitBranch className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            {selected ? `Worktree: ${selected.name}` : "Worktree"}
          </TooltipContent>
        </Tooltip>

        <PopoverContent align="end" side="top" className="w-72 p-1">
          {worktrees.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No worktrees — use <code className="font-mono">git worktree add</code> on the agent
              host
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {worktrees.map((wt) => (
                <li key={wt.id}>
                  <button
                    onClick={() => handleSelect(wt)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                      selected?.id === wt.id && "bg-accent/60 font-medium",
                    )}
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-left">{wt.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {truncatePath(wt.path)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
