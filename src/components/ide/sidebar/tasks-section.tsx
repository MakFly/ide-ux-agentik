import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  useIDE,
  useCurrentTasks,
  useCurrentWorktree,
  type BranchTask,
  type TaskStatus,
} from "@/store/ide";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TaskDialog } from "@/components/ide/task-dialog";
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

function TaskRow({
  task,
  worktreeId,
  onEdit,
  onDelete,
}: {
  task: BranchTask;
  worktreeId: string;
  onEdit: (task: BranchTask) => void;
  onDelete: (task: BranchTask) => void;
}) {
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
              onSelect={() => setTaskStatus(worktreeId, task.id, s)}
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
      <button
        type="button"
        onClick={() => onEdit(task)}
        className="min-w-0 flex-1 cursor-pointer text-left"
        title="Edit task"
      >
        <div className="truncate text-[12.5px] text-foreground">{task.title}</div>
        {task.description ? (
          <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[11.5px] text-muted-foreground/90">
            {task.description}
          </div>
        ) : null}
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">{task.assignee}</span>
          <span>·</span>
          <span className="truncate">{task.updatedAt}</span>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="mt-0.5 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
            title="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => onEdit(task)} className="gap-2 text-[12.5px]">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onDelete(task)}
            className="gap-2 text-[12.5px] text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TasksSection({ branchName }: { branchName: string | undefined }) {
  const tasks = useCurrentTasks();
  const currentWorktree = useCurrentWorktree();
  const activeWorktreeId = currentWorktree?.id ?? "";
  const addTask = useIDE((s) => s.addTask);
  const updateTask = useIDE((s) => s.updateTask);
  const removeTask = useIDE((s) => s.removeTask);
  const tasksLoading = useIDE((s) => s.tasksLoading);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<BranchTask | null>(null);
  const [deleteTask, setDeleteTask] = useState<BranchTask | null>(null);

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
                open > 0 ? "bg-status-warn/15 text-status-warn" : "bg-accent/60 text-foreground",
              )}
            >
              {open}/{tasks.length}
            </span>
          </span>
        </AccordionTrigger>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setCreateOpen(true);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="New task"
          disabled={!activeWorktreeId}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <AccordionContent className="pb-1 pt-0">
        <div className="space-y-0.5">
          {tasksLoading && tasks.length === 0 ? (
            <TasksSkeleton />
          ) : (
            <>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  worktreeId={activeWorktreeId}
                  onEdit={setEditTask}
                  onDelete={setDeleteTask}
                />
              ))}
              {!tasksLoading && tasks.length === 0 && (
                <div className="mx-3 rounded-md border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
                  No branch-linked tasks yet.
                </div>
              )}
            </>
          )}
        </div>
      </AccordionContent>

      <TaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={({ title, description }) => {
          if (!activeWorktreeId) return;
          addTask(activeWorktreeId, title, description || undefined);
          toast.success(`Task created on ${branchName ?? "branch"}`);
        }}
      />

      <TaskDialog
        open={editTask !== null}
        onOpenChange={(o) => {
          if (!o) setEditTask(null);
        }}
        mode="edit"
        defaultValue={
          editTask ? { title: editTask.title, description: editTask.description ?? "" } : undefined
        }
        onSubmit={({ title, description }) => {
          if (!editTask || !activeWorktreeId) return;
          updateTask(activeWorktreeId, editTask.id, { title, description });
          toast.success("Task updated");
          setEditTask(null);
        }}
      />

      <AlertDialog
        open={deleteTask !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTask(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTask ? (
                <>"{deleteTask.title}" will be removed from this worktree. This cannot be undone.</>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteTask || !activeWorktreeId) return;
                removeTask(activeWorktreeId, deleteTask.id);
                toast.success("Task deleted");
                setDeleteTask(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccordionItem>
  );
}
