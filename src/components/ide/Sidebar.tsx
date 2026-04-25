import { Building2, FolderPlus, HelpCircle, Plus, Settings, Star, GitBranch } from "lucide-react";
import { useContext, useState } from "react";
import { OrgContext } from "@/routes/org/$id";

import { toast } from "sonner";
import { Link, useNavigate } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { useIDE, useCurrentBranches, type Branch } from "@/store/ide";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AddWorkspaceDialog } from "@/components/ide/add-workspace-dialog";
import { PromptDialog } from "@/components/ide/prompt-dialog";
import { TasksSection } from "@/components/ide/sidebar/tasks-section";
import { WorkspaceTasksSection } from "@/components/ide/sidebar/workspace-tasks-section";
import { SessionsSection } from "@/components/ide/sidebar/sessions-section";
import { WorktreesSection } from "@/components/ide/sidebar/worktrees-section";
import { BranchesSkeleton } from "@/components/ide/skeletons/sidebar-skeletons";

function OrgSettingsLink() {
  const org = useContext(OrgContext);
  if (!org) return null;
  return (
    <Link
      to="/org/$id/settings"
      params={{ id: org.id }}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={`${org.name} settings`}
    >
      <Building2 className="h-4 w-4" />
    </Link>
  );
}

const SIDEBAR_SECTION_SCROLL_AREA_CLASS =
  "scrollbar-visible max-h-[min(20rem,40vh)] overflow-y-auto pb-1 pr-1";

function StatusDot({ status }: { status?: Branch["status"] }) {
  if (!status || status === "none") {
    return <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />;
  }
  if (status === "loading") {
    return (
      <span className="block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full border border-muted-foreground/60" />
    );
  }
  if (status === "warn") {
    return <span className="block h-2 w-2 shrink-0 rounded-full bg-status-warn" />;
  }
  if (status === "active") {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-status-warn/15 text-[9px] font-bold text-status-warn">
        ?
      </span>
    );
  }
  return <span className="block h-2 w-2 shrink-0 rounded-full bg-primary" />;
}

function BranchRow({ branch, active }: { branch: Branch; active: boolean }) {
  const setActiveBranch = useIDE((s) => s.setActiveBranch);
  const toggleStar = useIDE((s) => s.toggleStar);

  return (
    <div
      onClick={() => setActiveBranch(branch.id)}
      className={cn(
        "group mx-1.5 flex flex-col gap-0.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
        active ? "bg-branch-active" : "hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <StatusDot status={branch.status} />
        <span className="truncate font-mono text-foreground">{branch.name}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleStar(branch.id);
          }}
          className={cn(
            "transition-opacity",
            branch.starred ? "opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100",
          )}
        >
          <Star
            className={cn(
              "h-3 w-3",
              branch.starred ? "fill-status-warn text-status-warn" : "text-muted-foreground",
            )}
          />
        </button>
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
          {!!branch.added && <span className="text-status-add">+{branch.added}</span>}
          {!!branch.removed && <span className="text-status-del">-{branch.removed}</span>}
        </div>
      </div>
      <div className="pl-5 text-[11px] text-muted-foreground">{branch.age}</div>
    </div>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const workspaces = useIDE((s) => s.workspaces);
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const addBranch = useIDE((s) => s.addBranch);
  const setActiveWorkspace = useIDE((s) => s.setActiveWorkspace);
  const branchesLoading = useIDE((s) => s.branchesLoading);
  const currentBranches = useCurrentBranches();

  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const activeBranch = currentBranches.find((b) => b.id === activeBranchId);
  const defaultOpen = ["sessions", "branches", "worktrees", "workspace-tasks"];

  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-sidebar shadow-sm">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
          GIT STATE
        </span>
        <span className="truncate rounded bg-accent/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
          {activeWorkspace?.name ?? "—"} project
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Accordion type="multiple" defaultValue={defaultOpen} className="flex flex-col gap-0">
          {activeWorkspace?.source.kind === "remote-agent" ? (
            <WorkspaceTasksSection />
          ) : (
            <>
              {/* Branches of active project */}
              <AccordionItem value="branches" className="border-b-0">
                <div className="flex items-center pr-2">
                  <AccordionTrigger className="flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:no-underline hover:text-foreground">
                    <span className="flex items-center gap-2">
                      Branches
                      {activeWorkspace && (
                        <span className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground/70">
                          · {activeWorkspace.name} project
                        </span>
                      )}
                      <span className="rounded bg-accent/60 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-foreground">
                        {currentBranches.length}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setBranchDialogOpen(true);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="New branch"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <AccordionContent className="pb-1 pt-0">
                  <div className={SIDEBAR_SECTION_SCROLL_AREA_CLASS}>
                    {branchesLoading && currentBranches.length === 0 ? (
                      <BranchesSkeleton />
                    ) : (
                      <>
                        {currentBranches.map((b) => (
                          <BranchRow key={b.id} branch={b} active={b.id === activeBranchId} />
                        ))}
                        {!branchesLoading && currentBranches.length === 0 && (
                          <div className="mx-3 rounded-md border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
                            No branches.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Agent sessions of active project */}
              <SessionsSection />

              {/* Worktrees of active project */}
              <WorktreesSection />

              {/* Tasks of active branch */}
              <TasksSection branchName={activeBranch?.name} />
            </>
          )}
        </Accordion>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Link
          to="/settings"
          viewTransition
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Settings"
          style={{ viewTransitionName: "settings-trigger" }}
        >
          <Settings className="h-4 w-4" />
        </Link>
        <OrgSettingsLink />

        <button
          onClick={() => setWorkspaceDialogOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New project"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
        <div className="mx-auto flex items-center gap-1">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspace(ws.id)}
              title={ws.name}
              className={cn(
                "h-2 w-2 rounded-full transition-all hover:scale-125",
                ws.id === activeWorkspaceId
                  ? "ring-1 ring-offset-1 ring-offset-sidebar"
                  : "opacity-60",
              )}
              style={{
                background:
                  ws.id === activeWorkspaceId ? ws.color : "var(--color-muted-foreground)",
              }}
            />
          ))}
          <button
            onClick={() => setWorkspaceDialogOpen(true)}
            className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="New project"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <button
          onClick={() => navigate({ to: "/docs" })}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Documentation"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>

      <PromptDialog
        open={branchDialogOpen}
        onOpenChange={setBranchDialogOpen}
        title="New branch"
        description={`Create a new branch in ${activeWorkspace?.name ?? "this project"}.`}
        label="Branch name"
        placeholder="feat/new-awesome-thing"
        confirmLabel="Create branch"
        onSubmit={(name) => {
          if (activeWorkspaceId) {
            addBranch(activeWorkspaceId, name);
            toast.success(`Branch "${name}" created`);
          }
        }}
      />

      <AddWorkspaceDialog open={workspaceDialogOpen} onOpenChange={setWorkspaceDialogOpen} />
    </aside>
  );
}
