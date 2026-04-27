import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  useActiveAgentThread,
  useCurrentAgentThreads,
  useIDE,
  type AgentThreadView,
  type Workspace,
} from "@/store/ide";
import { RemoteAgentProvider, type Task } from "@/lib/fs/remote-agent";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TaskDetailDialog } from "@/components/ide/task-detail-dialog";

function threadStatusIcon(status: AgentThreadView["status"]) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-status-add" />;
  if (status === "failed" || status === "cancelled") {
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (status === "running") {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-status-warn" />;
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

function useNowTick(active: boolean, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

function elapsedTime(startedAt: number | null, endedAt: number | null, now: number): string {
  const start = startedAt ? startedAt : now;
  const end = endedAt ? endedAt : now;
  const elapsed = Math.floor((end - start) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  return `${Math.floor(elapsed / 3600)}h`;
}

function ThreadRow({
  thread,
  workspace,
  now,
}: {
  thread: AgentThreadView;
  workspace: Workspace;
  now: number;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const activeThread = useActiveAgentThread();
  const setActiveThread = useIDE((s) => s.setActiveThread);
  const removeTaskById = useIDE((s) => s.removeTaskById);
  const task = thread.rootTaskId
    ? (thread.tasks.find((candidate) => candidate.id === thread.rootTaskId) ?? thread.tasks[0])
    : thread.tasks[0];
  const active = activeThread?.id === thread.id;
  const isBusy =
    thread.status === "running" || thread.status === "queued" || thread.status === "awaiting";

  const cancelTask = async (target: Task) => {
    if (workspace.source.kind !== "remote-agent") return;
    const provider = new RemoteAgentProvider(
      workspace.source.label,
      workspace.source.url,
      workspace.source.token,
    );
    try {
      await provider.connect();
      await provider.taskCancel(target.id);
      toast.success("Thread cancelled");
    } catch (err) {
      toast.error("Failed to cancel thread");
      console.error(err);
    } finally {
      await provider.disconnect().catch(() => {});
    }
  };

  const removeWorktree = async (target: Task) => {
    if (workspace.source.kind !== "remote-agent") return;
    const provider = new RemoteAgentProvider(
      workspace.source.label,
      workspace.source.url,
      workspace.source.token,
    );
    try {
      await provider.connect();
      await provider.taskRemoveWorktree(target.id, true);
      removeTaskById(target.id);
      toast.success("Worktree removed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/task not found/i.test(msg)) {
        removeTaskById(target.id);
        toast.success("Worktree removed");
      } else {
        toast.error("Failed to remove worktree");
        console.error(err);
      }
    } finally {
      await provider.disconnect().catch(() => {});
    }
  };

  return (
    <div
      className={cn(
        "group mx-1.5 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        active ? "bg-branch-active" : "hover:bg-accent/50",
      )}
      data-thread-id={thread.id}
      data-task-id={task?.id}
    >
      <button
        type="button"
        onClick={() => setActiveThread(thread.id)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title="Open agent thread"
      >
        {threadStatusIcon(thread.status)}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-foreground">{thread.title}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span className="shrink-0 font-mono">{thread.cli}</span>
            {thread.branchName && (
              <>
                <span>-</span>
                <span className="truncate font-mono">{thread.branchName}</span>
              </>
            )}
            {task?.startedAt && (
              <>
                <span>-</span>
                <span data-task-elapsed>{elapsedTime(task.startedAt, task.endedAt, now)}</span>
              </>
            )}
          </div>
        </div>
      </button>
      {task && (
        <TaskDetailDialog
          task={task}
          workspace={workspace}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      )}
      {task && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <X className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setDetailOpen(true)} className="gap-2 text-[12.5px]">
                Details...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isBusy ? (
                <DropdownMenuItem
                  onClick={() => void cancelTask(task)}
                  className="gap-2 text-[12.5px]"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </DropdownMenuItem>
              ) : null}
              {(thread.status === "done" || thread.status === "failed") && thread.worktreePath ? (
                <DropdownMenuItem
                  onClick={() => void removeWorktree(task)}
                  className="gap-2 text-[12.5px] text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove worktree
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

export function WorkspaceTasksSection() {
  const workspace = useIDE((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const threads = useCurrentAgentThreads();
  const hydrateTasks = useIDE((s) => s.hydrateTasks);
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const connectionError = useIDE((s) => s.agentConnectionErrorByWorkspaceId[s.activeWorkspaceId]);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const setActiveThread = useIDE((s) => s.setActiveThread);
  const setActiveTask = useIDE((s) => s.setActiveTask);

  const hasRunning = threads.some((thread) => thread.status === "running");
  const now = useNowTick(hasRunning);
  const runningCount = threads.filter((thread) => thread.status === "running").length;

  const focusComposer = () => {
    setActiveTask(null);
    setActiveThread(null);
  };

  useEffect(() => {
    if (!workspace || workspace.source.kind !== "remote-agent") {
      setIsLoadingInitial(false);
      return;
    }
    setIsLoadingInitial(true);
    void hydrateTasks(workspaceId).finally(() => setIsLoadingInitial(false));
  }, [workspaceId, workspace, hydrateTasks]);

  if (!workspace || workspace.source.kind !== "remote-agent") return null;

  return (
    <AccordionItem value="workspace-tasks" className="border-b-0">
      <div className="flex items-center pr-2">
        <AccordionTrigger className="flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:no-underline hover:text-foreground">
          <span className="flex items-center gap-2">
            Agent Threads
            <span
              className="rounded bg-accent/60 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-foreground"
              title={`${runningCount} running · ${threads.length} total`}
            >
              {runningCount > 0 ? `${runningCount}/${threads.length}` : `${threads.length}`}
            </span>
          </span>
        </AccordionTrigger>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            focusComposer();
          }}
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New Agent"
          aria-label="New Agent"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <AccordionContent className="pb-1 pt-0">
        {isLoadingInitial ? (
          <div className="mx-3 rounded-md border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
            Loading agent threads...
          </div>
        ) : connectionError ? (
          <div className="mx-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-[11.5px] text-destructive">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{connectionError}</span>
            </div>
            <Link
              to="/settings"
              search={{ section: "agent" }}
              className="mt-2 inline-flex rounded border border-destructive/30 px-2 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              Update token
            </Link>
          </div>
        ) : threads.length === 0 ? (
          <button
            type="button"
            onClick={focusComposer}
            className="mx-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-left text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            New Agent - compose your first prompt
          </button>
        ) : (
          <div className="space-y-0.5">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} workspace={workspace} now={now} />
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
