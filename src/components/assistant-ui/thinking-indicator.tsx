/**
 * ThinkingIndicator — rich pending/running/streaming states for AssistantMessage.
 *
 * Sources:
 *  - https://github.com/anthropics/claude-code/issues/35987 (spinner verbs pattern)
 *  - https://alexop.dev/posts/assistant-ui-custom-components/ (assistant-ui context API)
 */
import { useAuiState } from "@assistant-ui/react";
import type { ThreadAssistantMessagePart } from "@assistant-ui/react";
import { BrainIcon, ListTodo, LoaderIcon, Terminal, Wrench } from "lucide-react";
import type { FC } from "react";
import { cn } from "@/lib/utils";

type ToolCallPart = Extract<ThreadAssistantMessagePart, { type: "tool-call" }>;

function toolIcon(toolName: string): FC<{ className?: string }> {
  const normalizedToolName = toolName.toLowerCase();
  if (normalizedToolName === "shell" || normalizedToolName === "bash") return Terminal;
  if (toolName === "plan") return ListTodo;
  return Wrench;
}

function toolLabel(part: ToolCallPart): string {
  const args = part.args as Record<string, unknown> | undefined;
  const normalizedToolName = part.toolName.toLowerCase();
  if ((normalizedToolName === "shell" || normalizedToolName === "bash") && args) {
    const cmd = String(args.command ?? args.cmd ?? "");
    if (cmd) return `Running ${part.toolName} · ${cmd.slice(0, 60)}${cmd.length > 60 ? "…" : ""}`;
  }
  return `Running ${part.toolName}`;
}

/** Returns the last tool-call part that has no result yet, or null. */
function pendingToolCall(parts: ReadonlyArray<ThreadAssistantMessagePart>): ToolCallPart | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === "tool-call" && p.result === undefined) {
      return p as ToolCallPart;
    }
  }
  return null;
}

export const ThinkingIndicator: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const isMessageRunning = useAuiState((s) => s.message.status?.type === "running");
  const parts = useAuiState(
    (s) => (s.message.content as ReadonlyArray<ThreadAssistantMessagePart>) ?? [],
  );

  // Pending = running AND no content yet
  const isPending = isRunning && parts.length === 0;

  // Tool running = running AND last part is an unresolved tool-call
  const activeTool = isRunning ? pendingToolCall(parts) : null;

  const lastPart = parts[parts.length - 1];
  const isAwaitingAfterTool =
    isMessageRunning && activeTool === null && lastPart?.type === "tool-call";

  // Streaming = running, has text/reasoning parts, no pending tool
  const isStreaming = isRunning && !isPending && activeTool === null && !isAwaitingAfterTool;

  // ── Streaming state: the streamed text/reasoning is already visible. ──
  if (isStreaming) {
    return null;
  }

  // ── Tool running state ──
  if (activeTool !== null) {
    const Icon = toolIcon(activeTool.toolName);
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-foreground">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{toolLabel(activeTool)}</span>
      </div>
    );
  }

  if (isAwaitingAfterTool) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Working"
        className="mt-2 flex items-center gap-2 py-1 text-muted-foreground text-sm"
      >
        <LoaderIcon className="size-4 shrink-0 animate-spin" />
        <span>Working</span>
      </div>
    );
  }

  // ── Pending state: no real part has arrived yet. Keep this generic instead
  // of implying a model exposed readable reasoning.
  if (isPending) {
    const label = "Working";
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className="aui-thinking-pending mb-4 flex items-center gap-2 py-1 text-muted-foreground text-sm"
      >
        <BrainIcon className="size-4 shrink-0" />
        <span className="relative inline-block leading-none">
          <span>{label}</span>
          <span
            aria-hidden
            className={cn(
              "shimmer pointer-events-none absolute inset-0",
              "motion-reduce:animate-none",
            )}
          >
            {label}
          </span>
        </span>
      </div>
    );
  }

  return null;
};
