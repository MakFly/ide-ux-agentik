import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, AlertTriangle, Clock, Trash2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIDE, type Workspace } from "@/store/ide";
import { RemoteAgentProvider, type Task } from "@/lib/fs/remote-agent";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TaskDetailDialog } from "@/components/ide/task-detail-dialog";

function taskStatusIcon(status: Task["status"]) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-status-add" />;
  if (status === "failed") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "running")
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-status-warn" />;
  if (status === "awaiting") return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
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

function elapsedTime(
  startedAt: number | null,
  endedAt: number | null,
  now: number = Date.now(),
): string {
  const start = startedAt ? startedAt : now;
  const end = endedAt ? endedAt : now;
  const elapsed = Math.floor((end - start) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  return `${Math.floor(elapsed / 3600)}h`;
}

function TaskRow({ task, workspace, now }: { task: Task; workspace: Workspace; now: number }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const setActiveSession = useIDE((s) => s.setActiveSession);
  const setActiveAgent = useIDE((s) => s.setActiveAgent);
  const setActiveTask = useIDE((s) => s.setActiveTask);
  const openTaskSession = useIDE((s) => s.openTaskSession);
  const activateInWorkspace = async () => {
    setActiveTask(task.id);
    // Lazily create session in DB if not yet persisted
    await openTaskSession(task.id);

    // If this is a child task, find its conversation's root session-tab.
    // Otherwise, use the task's own sessionId (or deterministic fallback).
    const deterministicSessionId = `${task.id}-session`;
    let targetSessionId = task.sessionId || deterministicSessionId;
    if (task.parentSessionId) {
      // Child task: find the conversation's session-tab via conversationRootTaskId.
      const tasksByWs = useIDE.getState().tasksByWorkspaceId[workspace.id] ?? [];
      const allSessions = useIDE.getState().sessionsByWorkspaceId[workspace.id] ?? [];
      // Walk up parent chain to find root
      let cur = task;
      const seen = new Set<string>();
      while (cur.parentSessionId) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const parent = tasksByWs.find((t) => t.sessionId === cur.parentSessionId);
        if (!parent) break;
        cur = parent;
      }
      // Now cur is the root task; find its session-tab
      const rootTab = allSessions.find((s) => s.taskRootId === cur.id || s.taskId === cur.id);
      if (rootTab) targetSessionId = rootTab.id;
    }
    setActiveSession(targetSessionId);
    setActiveAgent(task.cli as any);
  };
  return (
    <div
      className="group mx-1.5 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
      data-task-id={task.id}
    >
      <button
        type="button"
        onClick={activateInWorkspace}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title="Open in Workspace composer"
      >
        {taskStatusIcon(task.status)}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-foreground">{task.title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {task.branchName && <span className="truncate font-mono">{task.branchName}</span>}
            {task.startedAt && (
              <>
                <span>·</span>
                <span data-task-elapsed>{elapsedTime(task.startedAt, task.endedAt, now)}</span>
              </>
            )}
          </div>
        </div>
      </button>
      <TaskDetailDialog
        task={task}
        workspace={workspace}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <X className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setDetailOpen(true)} className="gap-2 text-[12.5px]">
              Details…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {task.status === "running" || task.status === "queued" || task.status === "awaiting" ? (
              <DropdownMenuItem
                onClick={async () => {
                  if (workspace.source.kind !== "remote-agent") return;
                  try {
                    const provider = new RemoteAgentProvider(
                      workspace.source.label,
                      workspace.source.url,
                      workspace.source.token,
                    );
                    await provider.connect();
                    await provider.taskCancel(task.id);
                    toast.success("Task cancelled");
                  } catch (err) {
                    toast.error("Failed to cancel task");
                    console.error(err);
                  }
                }}
                className="gap-2 text-[12.5px]"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </DropdownMenuItem>
            ) : null}
            {(task.status === "done" || task.status === "failed") && task.worktreePath ? (
              <DropdownMenuItem
                onClick={async () => {
                  if (workspace.source.kind !== "remote-agent") return;
                  try {
                    const provider = new RemoteAgentProvider(
                      workspace.source.label,
                      workspace.source.url,
                      workspace.source.token,
                    );
                    await provider.connect();
                    await provider.taskRemoveWorktree(task.id, true);
                    toast.success("Worktree removed");
                  } catch (err) {
                    toast.error("Failed to remove worktree");
                    console.error(err);
                  }
                }}
                className="gap-2 text-[12.5px] text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove worktree
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function WorkspaceTasksSection() {
  const workspace = useIDE((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const tasksByWorkspaceId = useIDE((s) => s.tasksByWorkspaceId);
  const hydrateTasks = useIDE((s) => s.hydrateTasks);
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const openNewTaskDialog = useIDE((s) => s.openNewTaskDialog);

  const tasks = tasksByWorkspaceId[workspaceId] ?? [];
  const hasRunning = tasks.some((t) => t.status === "running");
  const now = useNowTick(hasRunning);

  useEffect(() => {
    if (!workspace || workspace.source.kind !== "remote-agent") {
      setIsLoadingInitial(false);
      return;
    }
    setIsLoadingInitial(true);
    void hydrateTasks(workspaceId).finally(() => setIsLoadingInitial(false));
  }, [workspaceId, workspace, hydrateTasks]);

  const running = tasks.filter((t) => t.status === "running");
  const awaiting = tasks.filter((t) => t.status === "queued" || t.status === "awaiting");
  const done = tasks.filter((t) => t.status === "done").slice(-10);
  const failed = tasks.filter((t) => t.status === "failed");

  if (!workspace || workspace.source.kind !== "remote-agent") {
    return null;
  }

  const hasAny = tasks.length > 0;

  return (
    <AccordionItem value="workspace-tasks" className="border-b-0">
      <div className="flex items-center pr-2">
        <AccordionTrigger className="flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:no-underline hover:text-foreground">
          <span className="flex items-center gap-2">
            Tasks
            <span className="rounded bg-accent/60 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-foreground">
              {running.length}
            </span>
          </span>
        </AccordionTrigger>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openNewTaskDialog();
          }}
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New task (compose & dispatch)"
          aria-label="New task"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <AccordionContent className="pb-1 pt-0">
        {isLoadingInitial ? (
          <div className="mx-3 rounded-md border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
            Loading tasks…
          </div>
        ) : !hasAny ? (
          <button
            type="button"
            onClick={() => openNewTaskDialog()}
            className="mx-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-left text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            New task — compose your first prompt
          </button>
        ) : (
          <div className="space-y-2">
            {running.length > 0 && (
              <>
                <div className="mx-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Running
                </div>
                <div className="space-y-0.5">
                  {running.map((task) => (
                    <TaskRow key={task.id} task={task} workspace={workspace} now={now} />
                  ))}
                </div>
              </>
            )}

            {awaiting.length > 0 && (
              <>
                <div className="mx-3 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Awaiting
                </div>
                <div className="space-y-0.5">
                  {awaiting.map((task) => (
                    <TaskRow key={task.id} task={task} workspace={workspace} now={now} />
                  ))}
                </div>
              </>
            )}

            {done.length > 0 && (
              <>
                <div className="mx-3 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Done
                </div>
                <div className="space-y-0.5">
                  {done.map((task) => (
                    <TaskRow key={task.id} task={task} workspace={workspace} now={now} />
                  ))}
                </div>
              </>
            )}

            {failed.length > 0 && (
              <>
                <div className="mx-3 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Failed
                </div>
                <div className="space-y-0.5">
                  {failed.map((task) => (
                    <TaskRow key={task.id} task={task} workspace={workspace} now={now} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
