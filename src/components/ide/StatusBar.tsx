import { CircleDot, Copy, ExternalLink, GitBranch, GitCompare, GitPullRequest } from "lucide-react";
import { toast } from "sonner";
import {
  useIDE,
  useCurrentTasks,
  useCurrentWorktree,
  useCurrentWorktrees,
  type Branch,
} from "@/store/ide";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function branchStatusClass(status: Branch["status"]) {
  if (status === "active") return "bg-status-add/15 text-status-add";
  if (status === "warn") return "bg-status-warn/15 text-status-warn";
  if (status === "loading") return "bg-muted text-muted-foreground";
  return "bg-accent/60 text-foreground";
}

export function BranchDetailsPopover() {
  const workspaces = useIDE((s) => s.workspaces);
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const branch = workspace?.branches.find((item) => item.id === activeBranchId);
  const worktrees = useCurrentWorktrees();
  const currentWorktree = useCurrentWorktree();
  const tasks = useCurrentTasks();

  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const compareUrl =
    workspace?.gitUrl && branch ? `${workspace.gitUrl}/compare/${branch.name}` : undefined;
  const branchUrl =
    workspace?.gitUrl && branch ? `${workspace.gitUrl}/tree/${branch.name}` : undefined;

  const openExternal = (url?: string) => {
    if (!url) {
      toast.error("No git URL configured for this project");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyBranchName = async () => {
    if (!branch) return;
    try {
      await navigator.clipboard.writeText(branch.name);
      toast.success(`Copied "${branch.name}"`);
    } catch {
      toast.error("Could not copy branch name");
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="rounded p-0.5 transition-colors hover:text-foreground"
          title="Branch details"
        >
          <GitBranch className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 p-0">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Branch Details
              </div>
              <div className="mt-1 truncate font-mono text-[13px] text-foreground">
                {branch?.name ?? "—"}
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                {workspace?.name ?? "—"} project
              </div>
            </div>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
                branchStatusClass(branch?.status),
              )}
            >
              {branch?.status ?? "none"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Diff
              </div>
              <div className="mt-1 font-mono text-[12px]">
                <span className="text-status-add">+{branch?.added ?? 0}</span>{" "}
                <span className="text-status-del">-{branch?.removed ?? 0}</span>
              </div>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Tasks
              </div>
              <div className="mt-1 font-mono text-[12px] text-foreground">
                {openTasks}/{tasks.length} open
              </div>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Worktrees
              </div>
              <div className="mt-1 font-mono text-[12px] text-foreground">{worktrees.length}</div>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Active WT
              </div>
              <div className="mt-1 truncate font-mono text-[12px] text-foreground">
                {currentWorktree?.name ?? "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <button
              onClick={copyBranchName}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-foreground transition-colors hover:bg-accent"
            >
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              Copy branch name
            </button>
            <button
              onClick={() => openExternal(branchUrl)}
              disabled={!branchUrl}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              Open branch on GitHub
            </button>
            <button
              onClick={() => openExternal(compareUrl)}
              disabled={!compareUrl}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
              Compare branch
            </button>
            <button
              onClick={() =>
                openExternal(workspace?.gitUrl ? `${workspace.gitUrl}/pulls` : undefined)
              }
              disabled={!workspace?.gitUrl}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
              Pull requests
            </button>
            <button
              onClick={() =>
                openExternal(workspace?.gitUrl ? `${workspace.gitUrl}/issues` : undefined)
              }
              disabled={!workspace?.gitUrl}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
              Issues
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function StatusBar() {
  const { workspaces, activeBranchId, activeWorkspaceId } = useIDE();
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const branch = workspace?.branches.find((b) => b.id === activeBranchId);
  const currentWorktree = useCurrentWorktree();
  const tasks = useCurrentTasks();

  const busyTerminals =
    currentWorktree?.terminals.filter((t) => t.status === "busy").length ?? 0;
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress").length;

  let statusLabel: string;
  let statusTone: string;
  if (currentWorktree?.status === "syncing") {
    statusLabel = "Syncing";
    statusTone = "text-status-warn";
  } else if (currentWorktree?.status === "dirty") {
    statusLabel = "Dirty";
    statusTone = "text-status-warn";
  } else if (busyTerminals > 0) {
    statusLabel = `Agents · ${busyTerminals} busy`;
    statusTone = "text-status-add";
  } else if (inProgressTasks > 0) {
    statusLabel = `Tasks · ${inProgressTasks} in progress`;
    statusTone = "text-foreground";
  } else {
    statusLabel = "Ready";
    statusTone = "text-muted-foreground";
  }

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-titlebar px-3 text-[11.5px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className={cn("flex items-center gap-1.5", statusTone)}>
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              statusLabel.startsWith("Ready") && "bg-muted-foreground/60",
              (statusLabel.startsWith("Syncing") || statusLabel.startsWith("Dirty")) &&
                "bg-status-warn animate-pulse",
              statusLabel.startsWith("Agents") && "bg-status-add animate-pulse",
              statusLabel.startsWith("Tasks") && "bg-primary",
            )}
          />
          {statusLabel}
        </span>
        <span className="font-mono">{workspace?.name ?? "—"}</span>
        {currentWorktree && (
          <span className="font-mono text-muted-foreground/70">
            wt · {currentWorktree.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <BranchDetailsPopover />
        <span className="font-mono">{branch?.name ?? "—"}</span>
      </div>
    </footer>
  );
}
