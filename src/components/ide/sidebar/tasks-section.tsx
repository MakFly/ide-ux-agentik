import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  LoaderCircle,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useIDE, useCurrentTasks, type BranchTask, type TaskStatus } from "@/store/ide";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptDialog } from "@/components/ide/prompt-dialog";
import { TasksSkeleton } from "@/components/ide/skeletons/sidebar-skeletons";

function taskStatusClass(status: TaskStatus) {
  if (status === "done") return "bg-status-add/15 text-status-add";
  if (status === "blocked") return "bg-status-del/15 text-status-del";
  if (status === "in_progress") return "bg-status-warn/15 text-status-warn";
  return "bg-muted text-muted-foreground";
}

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "blocked") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (status === "in_progress") return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
  return <CircleDot className="h-3.5 w-3.5" />;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};
const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

function TaskRow({ task, branchId }: { task: BranchTask; branchId: string }) {
  const setTaskStatus = useIDE((s) => s.setTaskStatus);

  return (
    <div className="group mx-1.5 flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn("mt-0.5 rounded p-0.5", taskStatusClass(task.status))}
            title={STATUS_LABEL[task.status]}
          >
            <TaskStatusIcon status={task.status} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Set status
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {STATUSES.map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => setTaskStatus(branchId, task.id, s)}
              className={cn("gap-2 text-[12.5px]", task.status === s && "font-medium")}
            >
              <span className={cn("rounded p-0.5", taskStatusClass(s))}>
                <TaskStatusIcon status={s} />
              </span>
              {STATUS_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-foreground">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{task.assignee}</span>
          <span>·</span>
          <span className="truncate">{task.updatedAt}</span>
        </div>
      </div>
      <button
        className="mt-0.5 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title="More"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function TasksSection({ branchName }: { branchName: string | undefined }) {
  const tasks = useCurrentTasks();
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const addTask = useIDE((s) => s.addTask);
  const tasksLoading = useIDE((s) => s.tasksLoading);

  const [dialogOpen, setDialogOpen] = useState(false);
  const open = tasks.filter((t) => t.status !== "done").length;

  return (
    <AccordionItem value="tasks" className="border-b-0">
      <div className="flex items-center pr-2">
        <AccordionTrigger className="flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:no-underline hover:text-foreground">
          <span className="flex items-center gap-2">
            Tasks
            {branchName && (
              <span className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground/70">
                · {branchName}
              </span>
            )}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal",
                open > 0
                  ? "bg-status-warn/15 text-status-warn"
                  : "bg-accent/60 text-foreground",
              )}
            >
              {open}/{tasks.length}
            </span>
          </span>
        </AccordionTrigger>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDialogOpen(true);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New task"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <AccordionContent className="pb-1 pt-0">
        <div className="space-y-0.5">
          {tasksLoading ? (
            <TasksSkeleton />
          ) : (
            <>
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} branchId={activeBranchId} />
              ))}
              {tasks.length === 0 && (
                <div className="mx-3 rounded-md border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
                  No branch-linked tasks yet.
                </div>
              )}
            </>
          )}
        </div>
      </AccordionContent>

      <PromptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="New branch task"
        description="Create a task scoped to the current branch."
        label="Task title"
        placeholder="Investigate worktree boot race"
        confirmLabel="Create task"
        onSubmit={(value) => {
          addTask(activeBranchId, value);
          toast.success(`Task created on ${branchName ?? "branch"}`);
        }}
      />
    </AccordionItem>
  );
}
