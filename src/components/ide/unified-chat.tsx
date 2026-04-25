"use client";

import { useCallback, useState } from "react";
import { Send } from "lucide-react";
import { useIDE, type Workspace } from "@/store/ide";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TaskConversation } from "@/components/ide/task-conversation";

const CLI_OPTIONS = ["codex", "claude", "opencode", "gemini"] as const;

/**
 * UnifiedChat — routes between empty state and active task conversation.
 *
 * - If taskId is undefined: render empty-state composer (first prompt entry point).
 * - If taskId is provided: render TaskConversation for that task.
 */
export function UnifiedChat({ taskId }: { taskId?: string }) {
  const workspaces = useIDE((s) => s.workspaces);
  const tasksByWorkspaceId = useIDE((s) => s.tasksByWorkspaceId);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const createTaskFromPrompt = useIDE((s) => s.createTaskFromPrompt);
  const activeAgent = useIDE((s) => s.activeAgent);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
  if (!workspace) return null;

  // If taskId is provided, find the task and render TaskConversation
  if (taskId) {
    const allTasks = tasksByWorkspaceId[workspace.id] ?? [];
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) return null;
    return <TaskConversation task={task} workspace={workspace} />;
  }

  // Empty state: composer for first prompt
  return (
    <EmptyStateComposer
      workspace={workspace}
      activeAgent={activeAgent}
      onSubmit={createTaskFromPrompt}
    />
  );
}

interface EmptyStateComposerProps {
  workspace: Workspace;
  activeAgent: string;
  onSubmit: (
    prompt: string,
    options?: { cli?: string; model?: string; effort?: string },
  ) => Promise<void>;
}

function EmptyStateComposer({ workspace, activeAgent, onSubmit }: EmptyStateComposerProps) {
  const [text, setText] = useState("");
  const [selectedCli, setSelectedCli] = useState(activeAgent);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const prompt = text.trim();
      if (!prompt) return;

      setIsSubmitting(true);
      try {
        await onSubmit(prompt, { cli: selectedCli });
        setText("");
      } catch (err) {
        console.error("Failed to create task:", err);
        toast.error("Failed to create task");
      } finally {
        setIsSubmitting(false);
      }
    },
    [text, selectedCli, onSubmit],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold">Compose your first prompt</h2>
          <p className="text-sm text-muted-foreground">
            Select an AI CLI and describe what you'd like to do
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* CLI selector */}
          <div className="space-y-2">
            <label htmlFor="cli-select" className="text-sm font-medium">
              AI CLI
            </label>
            <select
              id="cli-select"
              value={selectedCli}
              onChange={(e) => setSelectedCli(e.target.value)}
              className={cn(
                "w-full rounded-md border border-input bg-card px-3 py-2",
                "text-[13px]",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "transition-colors",
              )}
            >
              {CLI_OPTIONS.map((cli) => (
                <option key={cli} value={cli}>
                  {cli}
                </option>
              ))}
            </select>
          </div>

          {/* Textarea */}
          <div className="space-y-2">
            <label htmlFor="prompt-input" className="text-sm font-medium">
              Prompt
            </label>
            <textarea
              id="prompt-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              placeholder="Type your prompt... (Ctrl/Cmd+Enter to send)"
              className={cn(
                "w-full rounded-md border border-input bg-card px-3 py-2",
                "text-[13px] placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "transition-colors resize-none",
                isSubmitting && "opacity-50 cursor-not-allowed",
              )}
              style={{ minHeight: "120px" }}
            />
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={!text.trim() || isSubmitting}
            className={cn(
              "w-full rounded-md px-4 py-2",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "flex items-center justify-center gap-2",
            )}
          >
            <Send className="h-4 w-4" />
            {isSubmitting ? "Creating task..." : "Submit"}
          </button>
        </form>
      </div>
    </div>
  );
}
