/**
 * ThinkingIndicator — rich pending/running/streaming states for AssistantMessage.
 *
 * Sources:
 *  - https://github.com/anthropics/claude-code/issues/35987 (spinner verbs pattern)
 *  - https://alexop.dev/posts/assistant-ui-custom-components/ (assistant-ui context API)
 */
import { useAuiState } from "@assistant-ui/react";
import type { ThreadAssistantMessagePart } from "@assistant-ui/react";
import { ListTodo, Terminal, Wrench } from "lucide-react";
import { useEffect, useState, type FC } from "react";
import { cn } from "@/lib/utils";
import { useThinkingElapsed } from "@/hooks/use-thinking-elapsed";

const VERBS = ["Thinking", "Considering", "Reasoning", "Analyzing"] as const;
const VERB_CYCLE_MS = 3_000;

function useVerbCycle(active: boolean): string {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!active) return;
    setIdx(0);
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % VERBS.length);
    }, VERB_CYCLE_MS);
    return () => clearInterval(id);
  }, [active]);

  return VERBS[idx];
}

type ToolCallPart = Extract<ThreadAssistantMessagePart, { type: "tool-call" }>;

function toolIcon(toolName: string): FC<{ className?: string }> {
  if (toolName === "shell" || toolName === "bash") return Terminal;
  if (toolName === "plan") return ListTodo;
  return Wrench;
}

function toolLabel(part: ToolCallPart): string {
  const args = part.args as Record<string, unknown> | undefined;
  if ((part.toolName === "shell" || part.toolName === "bash") && args) {
    const cmd = String(args.command ?? args.cmd ?? "");
    return `Running ${part.toolName} · ${cmd.slice(0, 60)}${cmd.length > 60 ? "…" : ""}`;
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
  const parts = useAuiState(
    (s) => (s.message.content as ReadonlyArray<ThreadAssistantMessagePart>) ?? [],
  );

  const elapsed = useThinkingElapsed();

  // Pending = running AND no content yet
  const isPending = isRunning && parts.length === 0;

  // Tool running = running AND last part is an unresolved tool-call
  const activeTool = isRunning ? pendingToolCall(parts) : null;

  // Streaming = running, has text/reasoning parts, no pending tool
  const isStreaming = isRunning && !isPending && activeTool === null;

  const verb = useVerbCycle(isPending);

  // ── Streaming state: just a subtle timer badge atop the bubble ──
  if (isStreaming) {
    return (
      <span className="mb-1 block text-[11px] text-muted-foreground/60 tabular-nums">
        {elapsed}s
      </span>
    );
  }

  // ── Tool running state ──
  if (activeTool !== null) {
    const Icon = toolIcon(activeTool.toolName);
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-foreground">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{toolLabel(activeTool)}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
          {elapsed}s
        </span>
      </div>
    );
  }

  // ── Pending state ──
  if (isPending) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {/* Pulsating dot */}
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-muted-foreground/60 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-muted-foreground/80" />
          </span>
          <span>
            {verb}
            <span className="ml-1.5 tabular-nums text-[11px] text-muted-foreground/60">
              · {elapsed}s
            </span>
          </span>
        </div>
        {/* Shimmer placeholder lines */}
        <div className="flex flex-col gap-1.5">
          <div className={cn("h-3 animate-pulse rounded bg-muted", "w-[72%]")} />
          <div className={cn("h-3 animate-pulse rounded bg-muted", "w-[52%]")} />
        </div>
      </div>
    );
  }

  return null;
};
