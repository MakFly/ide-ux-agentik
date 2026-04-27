/**
 * Tracks run timing and tool usage per assistant message.
 *
 * Architecture: module-level Map (not Context) because:
 * - Summaries are keyed on stable message IDs that never change after runEnd.
 * - Context would require wrapping every AssistantMessage; a Map avoids that.
 * - The data is write-once (set at runEnd) and purely display-oriented, so
 *   no React state synchronization issues arise.
 */

import { useEffect } from "react";
import { useAuiEvent, useAuiState } from "@assistant-ui/react";
import type { MessageState } from "@assistant-ui/react";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type ToolCounts = {
  shell: number;
  webSearch: number;
  fileEdits: number;
};

export type MessageSummary = {
  durationMs: number;
  toolCounts: ToolCounts;
};

/** Module-level map: messageId → summary. Written once at runEnd, never mutated. */
const summaryMap = new Map<string, MessageSummary>();

// Listeners notified when a new summary is stored.
type Listener = (messageId: string) => void;
const listeners = new Set<Listener>();

function emit(messageId: string) {
  for (const fn of listeners) fn(messageId);
}

// ---------------------------------------------------------------------------
// Public getters
// ---------------------------------------------------------------------------

export function getMessageSummary(messageId: string): MessageSummary | null {
  return summaryMap.get(messageId) ?? null;
}

/** Live-running run started-at timestamp (ms), or null if no run in flight. */
export function getRunStartedAt(): number | null {
  return pendingRun?.startedAt ?? null;
}

export function subscribeMessageSummary(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Tool count helpers
// ---------------------------------------------------------------------------

function countToolsInMessage(message: MessageState): ToolCounts {
  const counts: ToolCounts = { shell: 0, webSearch: 0, fileEdits: 0 };
  // `parts` is defined on the extended MessageState but TypeScript resolves
  // the union narrowing to the base ThreadMessage union (which includes system
  // messages without parts). Cast to access the field safely.
  const parts =
    (message as unknown as { parts?: readonly { type: string; toolName?: string }[] }).parts ?? [];
  for (const part of parts) {
    if (part.type !== "tool-call") continue;
    const name = part.toolName ?? "";
    if (name === "shell") counts.shell++;
    else if (name === "web_search" || name === "webSearch") counts.webSearch++;
    else if (
      name === "file_edit" ||
      name === "str_replace_editor" ||
      name === "create_file" ||
      name === "write_file"
    )
      counts.fileEdits++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Run tracker hook — call once at thread scope (inside Thread component)
// ---------------------------------------------------------------------------

type RunRef = { startedAt: number } | null;
let pendingRun: RunRef = null;

/**
 * Hook that wires up `thread.runStart` / `thread.runEnd` events and stores
 * a {@link MessageSummary} for each completed assistant turn.
 *
 * Must be mounted inside an AssistantRuntimeProvider context (i.e. inside Thread).
 * Call it once — the parent component does not need to be per-message.
 */
export function useRunTracker() {
  useAuiEvent("thread.runStart", () => {
    pendingRun = { startedAt: Date.now() };
  });

  // At runEnd we look at the last assistant message in the thread to compute
  // tool counts.  We need access to the thread state, but useAuiEvent callbacks
  // are not React components, so we use the `useAui` pattern via a separate
  // effect that reads state after runEnd fires.  We store a pending flag and
  // flush in a useEffect that observes isRunning toggling to false.
  useAuiEvent("thread.runEnd", (_payload) => {
    if (!pendingRun) return;
    const startedAt = pendingRun.startedAt;
    pendingRun = null;
    // Schedule the summary computation on the next microtask so the thread
    // state has been updated (the runEnd event fires synchronously before
    // React re-renders).
    setTimeout(() => {
      _flushPendingEnd(startedAt);
    }, 0);
  });
}

// We need to read the thread state outside React. We piggyback on a shared
// mutable ref that the thread component writes on each render via the hook
// below.
type ThreadStateRef = {
  messages: readonly MessageState[];
} | null;
let currentThreadStateRef: ThreadStateRef = null;

export function useRegisterThreadStateRef() {
  const messages = useAuiState((s) => s.thread.messages as readonly MessageState[]);
  useEffect(() => {
    currentThreadStateRef = { messages };
  });
}

function _flushPendingEnd(startedAt: number) {
  const ref = currentThreadStateRef;
  if (!ref) return;
  // Find the last assistant message.
  const msgs = ref.messages;
  let lastAssistant: MessageState | null = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === "assistant") {
      lastAssistant = msgs[i]!;
      break;
    }
  }
  if (!lastAssistant || !lastAssistant.id) return;

  const durationMs = Date.now() - startedAt;
  const toolCounts = countToolsInMessage(lastAssistant);
  summaryMap.set(lastAssistant.id, { durationMs, toolCounts });
  emit(lastAssistant.id);
}
