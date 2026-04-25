import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type TaskDialogValue = {
  title: string;
  description: string;
};

type TaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  defaultValue?: Partial<TaskDialogValue>;
  onSubmit: (value: TaskDialogValue) => void;
};

export function TaskDialog({
  open,
  onOpenChange,
  mode,
  defaultValue,
  onSubmit,
}: TaskDialogProps) {
  const [title, setTitle] = useState(defaultValue?.title ?? "");
  const [description, setDescription] = useState(defaultValue?.description ?? "");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setTitle(defaultValue?.title ?? "");
      setDescription(defaultValue?.description ?? "");
      setError(undefined);
    }
  }, [open, defaultValue?.title, defaultValue?.description]);

  const isEdit = mode === "edit";

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required");
      return;
    }
    onSubmit({ title: trimmed, description: description.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the task title and description."
                : "Create a task scoped to the current worktree."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-muted-foreground">
                Title
              </label>
              <Input
                autoFocus
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (error) setError(undefined);
                }}
                placeholder="Investigate worktree boot race"
                className="font-mono"
              />
              {error && <p className="text-[12px] text-destructive">{error}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-[12px] font-medium text-muted-foreground">
                Description
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details, acceptance criteria, links…"
                className="min-h-[120px] font-mono text-[12.5px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save" : "Create task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
