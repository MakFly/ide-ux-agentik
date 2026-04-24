import { useState } from "react";
import { GitBranch, Lock, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  useIDE,
  useProjectWorktrees,
  useCurrentWorktree,
  type TabId,
  type Worktree,
} from "@/store/ide";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PromptDialog } from "@/components/ide/prompt-dialog";
import { WorktreesSkeleton } from "@/components/ide/skeletons/sidebar-skeletons";

const SIDEBAR_SECTION_SCROLL_AREA_CLASS =
  "scrollbar-visible max-h-[min(20rem,40vh)] overflow-y-auto pb-1 pr-1";

function worktreeStatusClass(status: Worktree["status"]) {
  if (status === "dirty") return "bg-status-del/15 text-status-del";
  if (status === "syncing") return "bg-status-warn/15 text-status-warn";
  return "bg-status-add/15 text-status-add";
}

export function WorktreesSection() {
  const worktrees = useProjectWorktrees();
  const current = useCurrentWorktree();
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const setActiveWorktree = useIDE((s) => s.setActiveWorktree);
  const setActiveBranch = useIDE((s) => s.setActiveBranch);
  const setActiveTab = useIDE((s) => s.setActiveTab);
  const addWorktree = useIDE((s) => s.addWorktree);
  const worktreesLoading = useIDE((s) => s.worktreesLoading);

  const [dialogOpen, setDialogOpen] = useState(false);
  const project = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeBranch = project?.branches.find((branch) => branch.id === activeBranchId);

  const branchNameById = new Map(
    (project?.branches ?? []).map((branch) => [branch.id, branch.name] as const),
  );

  return (
    <AccordionItem value="worktrees" className="border-b-0">
      <div className="flex items-center pr-2">
        <AccordionTrigger className="flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:no-underline hover:text-foreground">
          <span className="flex items-center gap-2">
            Worktrees
            {project && (
              <span className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground/70">
                · {project.name} project
              </span>
            )}
            <span className="rounded bg-accent/60 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-foreground">
              {worktrees.length}
            </span>
          </span>
        </AccordionTrigger>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDialogOpen(true);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New worktree"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <AccordionContent className="pb-1 pt-0">
        <div className={cn("flex flex-col gap-0.5 px-1.5", SIDEBAR_SECTION_SCROLL_AREA_CLASS)}>
          {worktreesLoading && <WorktreesSkeleton />}
          {!worktreesLoading && worktrees.map((wt) => {
            const active = wt.id === current?.id;
            const branchName = branchNameById.get(wt.branchId) ?? "unknown-branch";
            return (
              <button
                key={wt.id}
                onClick={() => {
                  if (wt.branchId !== activeBranchId) {
                    setActiveBranch(wt.branchId);
                  }
                  setActiveWorktree(wt.id);
                  const first = wt.terminals[0];
                  setActiveTab(first ? (`terminal:${first.id}` as TabId) : "overview");
                }}
                className={cn(
                  "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  active ? "bg-branch-active" : "hover:bg-accent/50",
                )}
              >
                <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[12.5px] text-foreground">
                      {wt.name}
                    </span>
                    <span
                      className={cn(
                        "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        worktreeStatusClass(wt.status),
                      )}
                    >
                      {wt.status}
                    </span>
                    {wt.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  </div>
                  <div className="mt-0.5 truncate pr-1 font-mono text-[11px] text-muted-foreground">
                    {wt.path}
                  </div>
                  <div className="mt-0.5 truncate pr-1 font-mono text-[11px] text-muted-foreground/80">
                    branch · {branchName}
                  </div>
                </div>
              </button>
            );
          })}
          {!worktreesLoading && worktrees.length === 0 && (
            <div className="mx-1 rounded-md border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
              No worktrees yet for this project.
            </div>
          )}
        </div>
      </AccordionContent>

      <PromptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="New worktree"
        description="Create a new worktree attached to the active branch in this project."
        label="Worktree name"
        placeholder={activeBranch?.name.split("/").pop() ?? "feature-sandbox"}
        confirmLabel="Create worktree"
        onSubmit={(value) => {
          addWorktree(activeWorkspaceId, activeBranchId, value);
          toast.success(`Worktree "${value}" created`);
        }}
      />
    </AccordionItem>
  );
}
