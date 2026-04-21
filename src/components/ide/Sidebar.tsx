import { ChevronDown, Plus, Star, GitBranch, Settings, FolderPlus, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIDE, type Branch, type Workspace } from "@/store/ide";
import { useState } from "react";
import { toast } from "sonner";

function StatusDot({ status }: { status?: Branch["status"] }) {
  if (!status || status === "none") {
    return <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />;
  }
  if (status === "loading") {
    return <span className="block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full border border-muted-foreground/60" />;
  }
  if (status === "warn") {
    return <span className="block h-2 w-2 shrink-0 rounded-full bg-status-warn" />;
  }
  if (status === "active") {
    return <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-status-warn/15 text-[9px] font-bold text-status-warn">?</span>;
  }
  return <span className="block h-2 w-2 shrink-0 rounded-full bg-primary" />;
}

function BranchRow({ branch, active }: { branch: Branch; active: boolean }) {
  const { setActiveBranch, toggleStar } = useIDE();

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
          className={cn("transition-opacity", branch.starred ? "opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100")}
        >
          <Star className={cn("h-3 w-3", branch.starred ? "fill-status-warn text-status-warn" : "text-muted-foreground")} />
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

function WorkspaceHeader({ ws, onAdd }: { ws: Workspace; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div
        className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold text-white"
        style={{ background: ws.color }}
      >
        {ws.letter}
      </div>
      <span className="text-[13px] font-medium text-foreground">{ws.name}</span>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      <button
        onClick={onAdd}
        className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="New branch"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Sidebar() {
  const { workspaces, activeBranchId, showSidebar, addBranch, addWorkspace } = useIDE();
  const [newBranchFor, setNewBranchFor] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");

  if (!showSidebar) return null;

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="px-3 pt-3 pb-1">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
          SUPERCONDUCTOR
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {workspaces.map((ws) => (
          <div key={ws.id} className="mb-1">
            <WorkspaceHeader ws={ws} onAdd={() => setNewBranchFor(ws.id)} />
            {newBranchFor === ws.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (branchName.trim()) {
                    addBranch(ws.id, branchName.trim());
                    toast.success(`Branch "${branchName.trim()}" created`);
                    setBranchName("");
                    setNewBranchFor(null);
                  }
                }}
                className="mx-1.5 mb-1"
              >
                <input
                  autoFocus
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  onBlur={() => {
                    setNewBranchFor(null);
                    setBranchName("");
                  }}
                  placeholder="branch name…"
                  className="w-full rounded-md border border-primary/50 bg-input px-2 py-1.5 text-[12px] font-mono text-foreground focus:outline-none"
                />
              </form>
            )}
            {ws.branches.map((b) => (
              <BranchRow key={b.id} branch={b} active={b.id === activeBranchId} />
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          onClick={() => toast("Settings")}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            const name = prompt("New workspace name:");
            if (name?.trim()) {
              addWorkspace(name.trim());
              toast.success(`Workspace "${name.trim()}" added`);
            }
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New workspace"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
        <div className="mx-auto flex items-center gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn("h-1.5 w-1.5 rounded-full", i === 0 ? "bg-foreground" : "bg-muted-foreground/40")}
            />
          ))}
          <Plus className="ml-1 h-3 w-3 text-muted-foreground" />
        </div>
        <button
          onClick={() => toast("Need help? Check the docs.")}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
