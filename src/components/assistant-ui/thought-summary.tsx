"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import {
  getMessageSummary,
  subscribeMessageSummary,
  type MessageSummary,
} from "@/hooks/use-message-summary";
import {
  ReasoningRoot,
  ReasoningContent,
  ReasoningText,
} from "@/components/assistant-ui/reasoning";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s <= 120) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function buildSubLabels(counts: MessageSummary["toolCounts"]): string[] {
  const labels: string[] = [];
  if (counts.shell > 0) labels.push(`${counts.shell} shell call${counts.shell > 1 ? "s" : ""}`);
  if (counts.webSearch > 0)
    labels.push(`${counts.webSearch} web search${counts.webSearch > 1 ? "es" : ""}`);
  if (counts.fileEdits > 0)
    labels.push(`${counts.fileEdits} file edit${counts.fileEdits > 1 ? "s" : ""}`);
  return labels;
}

// ---------------------------------------------------------------------------
// Thought summary component
// ---------------------------------------------------------------------------

interface ThoughtSummaryProps {
  messageId: string;
}

/**
 * Renders a collapsible "Thought for Xs · N shell calls · ..." summary line
 * above an assistant message, once the turn is complete.
 *
 * Returns null while the message is still streaming or if no summary was
 * recorded (e.g. messages from history before the tracker was mounted).
 */
export function ThoughtSummary({ messageId }: ThoughtSummaryProps) {
  const [summary, setSummary] = useState<MessageSummary | null>(() => getMessageSummary(messageId));
  const [expanded, setExpanded] = useState(false);

  // Subscribe to new summaries in case the component mounts before runEnd.
  useEffect(() => {
    // Re-check immediately (race: summary may have arrived between render and effect).
    const existing = getMessageSummary(messageId);
    if (existing) {
      setSummary(existing);
      return;
    }
    return subscribeMessageSummary((id) => {
      if (id === messageId) {
        setSummary(getMessageSummary(messageId));
      }
    });
  }, [messageId]);

  // useAuiState selectors MUST return stable refs or primitives — filter/map
  // allocates a new array each render and tripped the "getSnapshot should be
  // cached" infinite loop. Select the raw parts ref (stable, memoized by
  // assistant-ui) and derive via useMemo.
  const currentMessageId = useAuiState((s) => s.message.id);
  const rawParts = useAuiState((s) => s.message.parts);
  const reasoningParts = useMemo<string[] | null>(() => {
    if (currentMessageId !== messageId) return null;
    return rawParts
      .filter((p) => p.type === "reasoning")
      .map((p) => (p as { type: "reasoning"; text: string }).text);
  }, [currentMessageId, messageId, rawParts]);

  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);

  if (!summary) return null;

  const durationLabel = `Thought for ${formatDuration(summary.durationMs)}`;
  const subLabels = buildSubLabels(summary.toolCounts);
  const hasReasoning = reasoningParts && reasoningParts.length > 0;
  const fullLabel = [durationLabel, ...subLabels].join(" · ");

  return (
    <div className="mb-2">
      {/* Summary line */}
      <button
        type="button"
        onClick={hasReasoning ? toggleExpand : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-1 py-0.5",
          "text-[11.5px] text-muted-foreground leading-none",
          "transition-colors",
          hasReasoning && "cursor-pointer hover:text-foreground",
          !hasReasoning && "cursor-default",
        )}
        aria-expanded={hasReasoning ? expanded : undefined}
        aria-label={fullLabel}
      >
        <CheckCircle2Icon className="size-3 shrink-0 text-green-500 dark:text-green-400" />
        <span className="truncate">{fullLabel}</span>
        {hasReasoning && (
          <ChevronRightIcon
            className={cn(
              "ml-auto size-3 shrink-0 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>

      {/* Expanded reasoning block — reuses Reasoning sub-components */}
      {hasReasoning && expanded && (
        <ReasoningRoot
          variant="muted"
          open
          onOpenChange={(open) => !open && setExpanded(false)}
          className="mt-1"
        >
          <ReasoningContent>
            <ReasoningText>
              {reasoningParts.map((text, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <p key={i} className="whitespace-pre-wrap text-xs">
                  {text}
                </p>
              ))}
            </ReasoningText>
          </ReasoningContent>
        </ReasoningRoot>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wrapper that reads the current message ID from context
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper used inside MessagePrimitive.Root — reads message.id
 * from the ambient message context via useAuiState.
 */
export function ThoughtSummaryForCurrentMessage() {
  const messageId = useAuiState((s) => s.message.id);
  if (!messageId) return null;
  return <ThoughtSummary messageId={messageId} />;
}
