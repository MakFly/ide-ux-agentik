"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { reduceCodexEvents } from "@/lib/chat/codex-conversation-reducer";
import { reduceClaudeEvents } from "@/lib/chat/claude-conversation-reducer";
import { ConversationView } from "@/components/ide/conversation-view";
import { useIDE, type Workspace } from "@/store/ide";
import { type Task, type TaskLogEntry } from "@/lib/fs/remote-agent";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const EMPTY_EVENTS: TaskLogEntry[] = [];
const EMPTY_TASKS: Task[] = [];

/**
 * TaskConversation — entry point for rendering a task's conversation.
 *
 * Responsibilities:
 * - Resolve conversation root and collect all descendant task IDs
 * - Aggregate events from all conversation tasks
 * - Run the appropriate reducer (codex or claude) to build ConversationState
 * - Render ConversationView + composer at the bottom
 *
 * The composer submits follow-ups, which create child tasks in the same conversation.
 */
export function TaskConversation({ task, workspace }: { task: Task; workspace: Workspace }) {
  const loadTaskLogs = useIDE((s) => s.loadTaskLogs);
  const allTasks = useIDE((s) => s.tasksByWorkspaceId[workspace.id] ?? EMPTY_TASKS);
  const eventsByTaskId = useIDE((s) => s.taskEventsByTaskId);

  // Resolve conversation root and collect all task ids in the conversation.
  const conversationTaskIds = useMemo<string[]>(() => {
    let cur = task;
    const seen = new Set<string>();
    while (cur.parentSessionId) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      const parent = allTasks.find((t) => t.sessionId === cur.parentSessionId);
      if (!parent) break;
      cur = parent;
    }
    const conversationRoot = cur;

    // BFS to collect root + all descendants
    const conversationTasks = [conversationRoot];
    const queue = [conversationRoot];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const t of allTasks) {
        if (
          t.parentSessionId === current.sessionId &&
          !conversationTasks.some((x) => x.id === t.id)
        ) {
          conversationTasks.push(t);
          queue.push(t);
        }
      }
    }
    return conversationTasks.map((t) => t.id);
  }, [task, allTasks]);

  // Collect and sort events from all conversation tasks.
  const events = useMemo<TaskLogEntry[]>(() => {
    const acc: TaskLogEntry[] = [];
    for (const taskId of conversationTaskIds) {
      const buf = eventsByTaskId[taskId];
      if (buf) acc.push(...buf);
    }
    acc.sort((a, b) => a.ts - b.ts);
    return acc;
  }, [conversationTaskIds, eventsByTaskId]);

  // Load logs if empty (refresh behavior).
  useEffect(() => {
    if (events.length === 0) {
      void loadTaskLogs(task.id);
    }
  }, [task.id, events.length, loadTaskLogs]);

  // Run the reducer to get ConversationState.
  const reducer = task.cli === "claude" ? reduceClaudeEvents : reduceCodexEvents;
  const conversationState = useMemo(() => {
    return reducer(events, task.prompt);
  }, [events, task.prompt, reducer]);

  const isRunning = task.status === "running" || task.status === "queued";

  // Composer state
  const [composerText, setComposerText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const handleComposerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComposerText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(Math.max(textareaRef.current.scrollHeight, 60), 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  };

  // Submit handler for follow-up message
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const text = composerText.trim();
      if (!text) return;
      if (workspace.source.kind !== "remote-agent") return;
      if (isRunning) {
        toast.error("Wait for the current turn to finish");
        return;
      }

      try {
        await useIDE.getState().continueTaskFromPrompt(task.id, text, {
          model: task.model ?? undefined,
          effort: task.effort ?? undefined,
        });
        setComposerText("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "60px";
        }
      } catch (err) {
        console.error("Failed to create follow-up task:", err);
        toast.error("Failed to create follow-up task");
      }
    },
    [composerText, workspace, task, isRunning],
  );

  // Cmd/Ctrl+Enter submits
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background min-h-0">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ConversationView state={conversationState} isRunning={isRunning} />
      </div>

      {/* Composer at the bottom */}
      <div className="flex-shrink-0 border-t border-border bg-background px-4 py-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={composerText}
            onChange={handleComposerChange}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder={
              isRunning
                ? "Wait for the current turn to finish or cancel"
                : "Follow-up message... (Ctrl/Cmd+Enter to send)"
            }
            className={cn(
              "flex-1 resize-none rounded-md border border-input bg-card px-3 py-2",
              "text-[13px] placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "transition-colors",
              isRunning && "opacity-50 cursor-not-allowed",
            )}
            style={{ minHeight: "60px", maxHeight: "200px" }}
          />
          <button
            type="submit"
            disabled={!composerText.trim() || isRunning}
            className={cn(
              "flex-shrink-0 rounded-md px-3 py-2",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "flex items-center justify-center",
            )}
            title={
              isRunning ? "Wait for the current turn to finish" : "Send message (Ctrl/Cmd+Enter)"
            }
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
