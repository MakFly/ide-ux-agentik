/**
 * Normalized conversation state types — pure data structures for rendering
 * a multi-turn agent conversation without assistant-ui Thread primitives.
 *
 * Derived from TaskLogEntry streams via reducers (codex, claude).
 * Keyed by item.id for efficient updates and dedup.
 */

export type Turn = {
  turnId: string; // turn.started timestamp or random
  startedAt: number;
  endedAt: number | null;
  itemIds: string[]; // order of appearance
};

export type ReasoningItem = {
  kind: "reasoning";
  itemId: string;
  text: string; // accumulated via deltas
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
};

export type ToolCallItem = {
  kind: "tool_call";
  itemId: string;
  toolName: string; // "exec" / "read" / etc — according to item type
  command?: string; // command_execution
  input?: unknown; // for generic tool_use
  output?: string; // aggregated_output / stdout
  exitCode: number | null;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt: number | null;
};

export type AssistantTextItem = {
  kind: "assistant_text";
  itemId: string;
  text: string;
  ts: number;
};

export type UserMessageItem = {
  kind: "user";
  itemId: string;
  text: string;
  ts: number;
};

export type Item = ReasoningItem | ToolCallItem | AssistantTextItem | UserMessageItem;

export type ConversationState = {
  turns: Turn[];
  itemsById: Record<string, Item>;
  itemOrder: string[]; // ordered by ts of first appearance
};
