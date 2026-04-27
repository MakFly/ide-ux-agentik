"use client";

import { useLayoutEffect, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  type ConversationState,
  type AssistantTextItem,
  type ToolCallItem,
  type ReasoningItem,
  type UserMessageItem,
  type Item,
} from "@/lib/chat/conversation-types";
import { cn } from "@/lib/utils";

/**
 * Main conversation renderer — displays a ConversationState as a chat-like UI
 * with user bubbles, reasoning blocks, tool cards, and assistant markdown.
 *
 * Sticks to bottom while user hasn't scrolled up (ChatGPT / Copilot style).
 * PendingIndicator shows while a turn is open and isRunning is true.
 */
export function ConversationView({
  state,
  isRunning,
}: {
  state: ConversationState;
  isRunning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const itemCount = state.itemOrder.length;

  // Stick-to-bottom while user hasn't scrolled up.
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    if (isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [itemCount]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = dist < 24;
  };

  const lastTurn = state.turns[state.turns.length - 1];
  const turnRunning = isRunning && lastTurn && !lastTurn.endedAt;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto bg-background scrollbar-visible"
    >
      {state.itemOrder.map((id) => {
        const it = state.itemsById[id];
        if (!it) return null;
        if (it.kind === "user") return <UserBubble key={id} item={it} />;
        if (it.kind === "reasoning")
          return <ReasoningBlock key={id} item={it} streaming={isRunning && !it.completedAt} />;
        if (it.kind === "tool_call") return <ToolCallCard key={id} item={it} />;
        if (it.kind === "assistant_text") return <AssistantMarkdown key={id} item={it} />;
        return null;
      })}
      {turnRunning && <PendingIndicator />}
    </div>
  );
}

/**
 * User message — right-aligned bubble with primary background.
 */
function UserBubble({ item }: { item: UserMessageItem }) {
  return (
    <div className="flex justify-end px-4 py-2">
      <div className="max-w-[80%] rounded-lg bg-primary/10 px-3.5 py-2 text-[13px] text-foreground whitespace-pre-wrap break-words">
        {item.text}
      </div>
    </div>
  );
}

/**
 * Reasoning block — collapsible details with streaming indicator.
 * Opens automatically while streaming, collapses on completion showing duration.
 */
function ReasoningBlock({ item, streaming }: { item: ReasoningItem; streaming: boolean }) {
  return (
    <details
      open={streaming || undefined}
      className="group mx-4 my-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-[12.5px]"
    >
      <summary className="flex items-center gap-2 cursor-pointer select-none text-muted-foreground hover:text-foreground">
        <Brain className="h-3.5 w-3.5 flex-shrink-0" />
        {streaming ? (
          <span className="inline-flex items-center gap-1 italic">
            Thinking
            <DotDotDot />
          </span>
        ) : (
          <span>Thought for {formatDuration(item.durationMs ?? 0)}</span>
        )}
      </summary>
      <div className="mt-2 whitespace-pre-wrap font-sans text-foreground/75 leading-relaxed">
        {item.text || (streaming && <span className="text-muted-foreground italic">…</span>)}
      </div>
    </details>
  );
}

/**
 * Animated three-dot ellipsis for streaming indicator.
 */
function DotDotDot() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="animate-pulse">.</span>
      <span className="animate-pulse" style={{ animationDelay: "150ms" }}>
        .
      </span>
      <span className="animate-pulse" style={{ animationDelay: "300ms" }}>
        .
      </span>
    </span>
  );
}

/**
 * Tool call card — displays command/input, status icon, exit code badge,
 * and collapsible output pane.
 */
function ToolCallCard({ item }: { item: ToolCallItem }) {
  const isSubagent = item.toolName === "spawn_agent";
  const headerLabel = isSubagent ? "Sub-agent" : item.toolName;
  const subLabel = item.displayName ?? null;
  const inputPreview =
    !item.command && item.input != null ? JSON.stringify(item.input).slice(0, 80) : null;

  return (
    <div className="mx-4 my-2 rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 text-[11.5px] flex-wrap">
        <StatusIcon status={item.status} />
        <span className="font-mono font-medium text-foreground">{headerLabel}</span>
        {subLabel && (
          <span className="rounded-md border border-border/60 bg-muted/45 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
            {subLabel}
          </span>
        )}
        {item.command && (
          <span
            className="font-mono text-muted-foreground truncate flex-1 min-w-0"
            title={item.command}
          >
            $ {item.command}
          </span>
        )}
        {!item.command && inputPreview && (
          <span
            className="text-muted-foreground truncate flex-1 min-w-0"
            title={JSON.stringify(item.input)}
          >
            {inputPreview}
          </span>
        )}
        {item.exitCode !== null && item.exitCode !== undefined && (
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0",
              item.exitCode === 0
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "bg-destructive/15 text-destructive",
            )}
          >
            exit {item.exitCode}
          </span>
        )}
        {item.completedAt && item.startedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground font-mono flex-shrink-0">
            {formatDuration(item.completedAt - item.startedAt)}
          </span>
        )}
      </div>
      {item.output && (
        <details className="bg-code-bg/40">
          <summary className="px-3 py-1 text-[10.5px] text-muted-foreground cursor-pointer hover:text-foreground">
            output ({item.output.length} chars)
          </summary>
          <pre className="px-3 py-2 max-h-72 overflow-y-auto font-mono text-[11.5px] whitespace-pre-wrap text-foreground/85 break-words">
            {item.output}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * Status icon for tool calls — spinner (running), checkmark (ok), or X (failed).
 */
function StatusIcon({ status }: { status: ToolCallItem["status"] }) {
  if (status === "running")
    return (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
    );
  if (status === "failed")
    return <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-500 flex-shrink-0" />;
}

/**
 * Assistant text — rendered as markdown with remark-gfm for tables, strikethrough, etc.
 */
function AssistantMarkdown({ item }: { item: AssistantTextItem }) {
  return (
    <div className="mx-4 my-2 px-1 text-[13.5px] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => (
            <pre className="rounded-md bg-code-bg/60 p-3 my-2 overflow-x-auto text-[12px] font-mono text-foreground/90">
              {children}
            </pre>
          ),
          code: ({ inline, children, ...props }: any) =>
            inline ? (
              <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono" {...props}>
                {children}
              </code>
            ) : (
              <code {...props}>{children}</code>
            ),
          ul: ({ children }: any) => (
            <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>
          ),
          ol: ({ children }: any) => (
            <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>
          ),
          blockquote: ({ children }: any) => (
            <blockquote className="border-l-2 border-border/50 pl-3 italic text-foreground/75 my-2">
              {children}
            </blockquote>
          ),
          table: ({ children }: any) => (
            <table className="border-collapse border border-border text-[12px] my-2">
              {children}
            </table>
          ),
          thead: ({ children }: any) => <thead className="bg-muted/40">{children}</thead>,
          tr: ({ children }: any) => <tr className="border-b border-border">{children}</tr>,
          td: ({ children }: any) => <td className="border border-border px-2 py-1">{children}</td>,
          th: ({ children }: any) => (
            <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
          ),
        }}
      >
        {item.text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Pending indicator — shown when a turn is open and the task is still running.
 */
function PendingIndicator() {
  return (
    <div className="mx-4 my-2 flex items-center gap-2 px-3 py-1 text-[11.5px] text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span className="italic">Generating…</span>
    </div>
  );
}

/**
 * Format milliseconds as human-readable duration.
 * E.g., 500ms, 3s, 1m 4s
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sRem = s % 60;
  return sRem > 0 ? `${m}m ${sRem}s` : `${m}m`;
}
