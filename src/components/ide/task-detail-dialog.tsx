import { useEffect, useState, type FC } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, LoaderCircle, Clock, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { RemoteAgentProvider, type Task } from "@/lib/fs/remote-agent";
import { useIDE, type Workspace } from "@/store/ide";
import { TaskConversation } from "@/components/ide/task-conversation";

function statusBadge(status: Task["status"]) {
  const map: Record<
    Task["status"],
    { label: string; className: string; Icon: typeof CheckCircle2 }
  > = {
    queued: { label: "Queued", className: "bg-muted text-muted-foreground", Icon: Clock },
    awaiting: { label: "Awaiting", className: "bg-muted text-muted-foreground", Icon: Clock },
    running: {
      label: "Running",
      className: "bg-status-warn/15 text-status-warn",
      Icon: LoaderCircle,
    },
    done: {
      label: "Done",
      className: "bg-status-add/15 text-status-add",
      Icon: CheckCircle2,
    },
    failed: {
      label: "Failed",
      className: "bg-destructive/15 text-destructive",
      Icon: AlertTriangle,
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-muted text-muted-foreground",
      Icon: X,
    },
  };
  const v = map[status] ?? map.queued;
  const Icon = v.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
        v.className,
      )}
    >
      <Icon className={cn("h-3 w-3", status === "running" && "animate-spin")} />
      {v.label}
    </span>
  );
}

function formatTs(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function durationOf(t: Task): string {
  const start = t.startedAt ?? t.createdAt;
  const end = t.endedAt ?? Date.now();
  if (!start) return "—";
  const s = Math.max(0, Math.floor((end - start) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const TaskDetailDialog: FC<{
  task: Task;
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ task, workspace, open, onOpenChange }) => {
  const [busy, setBusy] = useState(false);
  const isTerminal =
    task.status === "done" || task.status === "failed" || task.status === "cancelled";
  const canCancel =
    task.status === "running" || task.status === "queued" || task.status === "awaiting";

  const callRemote = async (
    fn: (p: RemoteAgentProvider) => Promise<unknown>,
    successMsg: string,
    errorMsg: string,
  ) => {
    if (workspace.source.kind !== "remote-agent") return;
    setBusy(true);
    try {
      const provider = new RemoteAgentProvider(
        workspace.source.label,
        workspace.source.url,
        workspace.source.token,
      );
      await provider.connect();
      await fn(provider);
      toast.success(successMsg);
      onOpenChange(false);
    } catch (err) {
      console.error("[TaskDetailDialog]", errorMsg, err);
      toast.error(err instanceof Error ? err.message : errorMsg);
    } finally {
      setBusy(false);
    }
  };

  // Pre-select the right tab on open: Transcript whenever the task has events
  // to show (running, done, failed, cancelled). Overview for queued/awaiting.
  const initialTab =
    task.status === "running" ||
    task.status === "done" ||
    task.status === "failed" ||
    task.status === "cancelled"
      ? "transcript"
      : "overview";
  const [tab, setTab] = useState<string>(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(92vw,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border bg-muted/30 px-5 py-3">
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="truncate text-base">{task.title}</DialogTitle>
            {statusBadge(task.status)}
          </div>
          <DialogDescription className="font-mono text-[11px]">
            {task.branchName ?? "(branch not assigned)"}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          <TabsList className="mx-5 mt-3 w-fit shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>

          <TabsContent
            value="overview"
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4 data-[state=inactive]:hidden"
          >
            <div className="space-y-3 text-[12.5px]">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Prompt
                </div>
                <pre className="mt-1 max-h-40 whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-sans text-foreground">
                  {task.prompt}
                </pre>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="CLI" value={task.cli} mono />
                <Field label="Duration" value={durationOf(task)} />
                <Field label="Model" value={task.model ?? "(default)"} mono />
                <Field label="Effort" value={task.effort ?? "(default)"} mono />
                <Field label="Created" value={formatTs(task.createdAt)} />
                <Field label="Ended" value={formatTs(task.endedAt)} />
                {typeof task.exitCode === "number" && (
                  <Field label="Exit code" value={String(task.exitCode)} mono />
                )}
                {task.worktreePath && (
                  <Field label="Worktree" value={task.worktreePath} mono className="col-span-2" />
                )}
              </div>

              {task.errorMessage && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">
                    Error
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-2 font-mono text-[11.5px] text-destructive">
                    {task.errorMessage}
                  </pre>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="transcript"
            className="flex min-h-0 flex-1 flex-col px-5 py-3 data-[state=inactive]:hidden"
          >
            <TaskConversation task={task} workspace={workspace} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:gap-2">
          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                callRemote((p) => p.taskCancel(task.id), "Task cancelled", "Failed to cancel task")
              }
            >
              <X className="h-3.5 w-3.5" />
              Cancel task
            </Button>
          )}
          {isTerminal && (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() =>
                callRemote(
                  async (p) => {
                    await p.taskRemoveWorktree(task.id, true);
                    // Belt-and-suspenders: tombstone locally even if the
                    // broadcast doesn't arrive (older agent build).
                    useIDE.getState().removeTaskById(task.id);
                  },
                  "Task removed",
                  "Failed to remove task",
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              {task.worktreePath ? "Remove worktree" : "Delete task"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Field: FC<{ label: string; value: string; mono?: boolean; className?: string }> = ({
  label,
  value,
  mono,
  className,
}) => (
  <div className={className}>
    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {label}
    </div>
    <div className={cn("mt-0.5 truncate text-foreground", mono && "font-mono text-[11.5px]")}>
      {value}
    </div>
  </div>
);
