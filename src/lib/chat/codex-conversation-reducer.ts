/**
 * Pure reducer: TaskLogEntry[] → ConversationState for Codex CLI.
 *
 * Rules:
 * - thread.started → reset to empty state
 * - turn.started → push new Turn with turnId = ts
 * - item.started { item: { id, type } } → create placeholder item
 * - reasoning { text, delta: true } → append to currentReasoningId.text
 * - item.completed { item: { id, type, ...final } } → upgrade or create item
 * - assistant_message (TOP-LEVEL) → dedup vs existing items in current turn
 * - user_message (TOP-LEVEL) → dedup vs existing items in current turn
 * - turn.completed → set Turn.endedAt
 * - initialPrompt → seed UserMessageItem at index 0 if not present
 */

import type { TaskLogEntry } from "@/lib/fs/remote-agent";
import type {
  AssistantTextItem,
  ConversationState,
  ReasoningItem,
  ToolCallItem,
  Turn,
  UserMessageItem,
} from "./conversation-types";

export function reduceCodexEvents(
  events: TaskLogEntry[],
  initialPrompt: string,
): ConversationState {
  const state: ConversationState = {
    turns: [],
    itemsById: {},
    itemOrder: [],
  };

  let currentTurnId: string | null = null;
  let currentReasoningItemId: string | null = null;

  for (const entry of events) {
    const data = entry.data as Record<string, unknown>;
    const type = data.type as string | undefined;

    switch (type) {
      case "thread.started":
        // Reset to empty state
        state.turns = [];
        state.itemsById = {};
        state.itemOrder = [];
        currentTurnId = null;
        currentReasoningItemId = null;
        break;

      case "turn.started":
        // Push new turn, reset current reasoning
        const turnId = `t${entry.ts}`;
        state.turns.push({
          turnId,
          startedAt: entry.ts,
          endedAt: null,
          itemIds: [],
        });
        currentTurnId = turnId;
        currentReasoningItemId = null;
        break;

      case "item.started": {
        const itemData = data.item as Record<string, unknown> | undefined;
        if (!itemData) break;

        const itemId = itemData.id as string | undefined;
        const itemType = itemData.type as string | undefined;

        if (!itemId || !itemType || !currentTurnId) break;

        const currentTurn = state.turns.find((t) => t.turnId === currentTurnId);
        if (!currentTurn) break;

        if (itemType === "reasoning") {
          const reasoningItem: ReasoningItem = {
            kind: "reasoning",
            itemId,
            text: "",
            startedAt: entry.ts,
            completedAt: null,
            durationMs: null,
          };
          state.itemsById[itemId] = reasoningItem;
          currentTurn.itemIds.push(itemId);
          state.itemOrder.push(itemId);
          currentReasoningItemId = itemId;
        } else if (itemType === "command_execution") {
          const command = itemData.command as string | undefined;
          const toolItem: ToolCallItem = {
            kind: "tool_call",
            itemId,
            toolName: "exec",
            command,
            status: "running",
            output: "",
            exitCode: null,
            startedAt: entry.ts,
            completedAt: null,
          };
          state.itemsById[itemId] = toolItem;
          currentTurn.itemIds.push(itemId);
          state.itemOrder.push(itemId);
        } else if (itemType === "assistant_message") {
          const textItem: AssistantTextItem = {
            kind: "assistant_text",
            itemId,
            text: "",
            ts: entry.ts,
          };
          state.itemsById[itemId] = textItem;
          currentTurn.itemIds.push(itemId);
          state.itemOrder.push(itemId);
        } else {
          // Generic tool_use type
          const toolItem: ToolCallItem = {
            kind: "tool_call",
            itemId,
            toolName: itemType,
            input: itemData,
            status: "running",
            exitCode: null,
            startedAt: entry.ts,
            completedAt: null,
          };
          state.itemsById[itemId] = toolItem;
          currentTurn.itemIds.push(itemId);
          state.itemOrder.push(itemId);
        }
        break;
      }

      case "reasoning": {
        const text = data.text as string | undefined;
        const delta = data.delta as boolean | undefined;

        if (!text || !delta) break;

        // Append to current reasoning item or create orphan
        if (currentReasoningItemId && state.itemsById[currentReasoningItemId]) {
          const item = state.itemsById[currentReasoningItemId];
          if (item.kind === "reasoning") {
            item.text += text;
          }
        } else if (currentTurnId) {
          // Orphan reasoning (rare): create a new item if needed
          const orphanId = `reasoning-orphan-${entry.ts}`;
          const currentTurn = state.turns.find((t) => t.turnId === currentTurnId);
          if (currentTurn && !state.itemsById[orphanId]) {
            const reasoningItem: ReasoningItem = {
              kind: "reasoning",
              itemId: orphanId,
              text,
              startedAt: entry.ts,
              completedAt: null,
              durationMs: null,
            };
            state.itemsById[orphanId] = reasoningItem;
            currentTurn.itemIds.push(orphanId);
            state.itemOrder.push(orphanId);
            currentReasoningItemId = orphanId;
          }
        }
        break;
      }

      case "item.completed": {
        const itemData = data.item as Record<string, unknown> | undefined;
        if (!itemData) break;

        const itemId = itemData.id as string | undefined;
        const itemType = itemData.type as string | undefined;

        if (!itemId) break;

        const existingItem = state.itemsById[itemId];

        if (itemType === "reasoning") {
          const finalText = itemData.text as string | undefined;
          if (existingItem && existingItem.kind === "reasoning") {
            existingItem.text = finalText || existingItem.text;
            existingItem.completedAt = entry.ts;
            if (existingItem.startedAt) {
              existingItem.durationMs = entry.ts - existingItem.startedAt;
            }
          } else if (finalText && currentTurnId) {
            // Create if not present (shouldn't happen if item.started arrives first)
            const reasoningItem: ReasoningItem = {
              kind: "reasoning",
              itemId,
              text: finalText,
              startedAt: entry.ts,
              completedAt: entry.ts,
              durationMs: 0,
            };
            state.itemsById[itemId] = reasoningItem;
            const currentTurn = state.turns.find((t) => t.turnId === currentTurnId);
            if (currentTurn && !currentTurn.itemIds.includes(itemId)) {
              currentTurn.itemIds.push(itemId);
              state.itemOrder.push(itemId);
            }
          }
        } else if (itemType === "command_execution") {
          const output = itemData.aggregated_output as string | undefined;
          const exitCode = itemData.exit_code as number | undefined;
          const status = exitCode === 0 ? "completed" : "failed";

          if (existingItem && existingItem.kind === "tool_call") {
            existingItem.output = output || "";
            existingItem.exitCode = exitCode ?? null;
            existingItem.status = (status as "completed" | "failed") || "completed";
            existingItem.completedAt = entry.ts;
          } else if (currentTurnId) {
            const toolItem: ToolCallItem = {
              kind: "tool_call",
              itemId,
              toolName: "exec",
              command: itemData.command as string | undefined,
              output: output || "",
              exitCode: exitCode ?? null,
              status: (status as "completed" | "failed") || "completed",
              startedAt: entry.ts,
              completedAt: entry.ts,
            };
            state.itemsById[itemId] = toolItem;
            const currentTurn = state.turns.find((t) => t.turnId === currentTurnId);
            if (currentTurn && !currentTurn.itemIds.includes(itemId)) {
              currentTurn.itemIds.push(itemId);
              state.itemOrder.push(itemId);
            }
          }
        } else if (itemType === "assistant_message") {
          const text = itemData.text as string | undefined;
          if (existingItem && existingItem.kind === "assistant_text") {
            existingItem.text = text || existingItem.text;
          } else if (text && currentTurnId) {
            const textItem: AssistantTextItem = {
              kind: "assistant_text",
              itemId,
              text,
              ts: entry.ts,
            };
            state.itemsById[itemId] = textItem;
            const currentTurn = state.turns.find((t) => t.turnId === currentTurnId);
            if (currentTurn && !currentTurn.itemIds.includes(itemId)) {
              currentTurn.itemIds.push(itemId);
              state.itemOrder.push(itemId);
            }
          }
        } else if (existingItem && existingItem.kind === "tool_call") {
          // Generic tool upgrade
          existingItem.completedAt = entry.ts;
          if (typeof itemData.output === "string") {
            existingItem.output = itemData.output;
          }
          if (typeof itemData.status === "string") {
            existingItem.status = itemData.status as "running" | "completed" | "failed";
          }
        }

        if (currentReasoningItemId === itemId) {
          currentReasoningItemId = null;
        }
        break;
      }

      case "assistant_message": {
        // TOP-LEVEL assistant_message — dedup vs existing items in current turn
        const text = data.text as string | undefined;
        if (!text || !currentTurnId) break;

        const currentTurn = state.turns.find((t) => t.turnId === currentTurnId);
        if (!currentTurn) break;

        // Check if any AssistantTextItem in current turn has same text
        const hasMatchingText = currentTurn.itemIds.some((id) => {
          const item = state.itemsById[id];
          return item && item.kind === "assistant_text" && item.text.trim() === text.trim();
        });

        if (!hasMatchingText) {
          const itemId = `assistant-${entry.ts}`;
          const textItem: AssistantTextItem = {
            kind: "assistant_text",
            itemId,
            text,
            ts: entry.ts,
          };
          state.itemsById[itemId] = textItem;
          currentTurn.itemIds.push(itemId);
          state.itemOrder.push(itemId);
        }
        break;
      }

      case "user_message": {
        // TOP-LEVEL user_message — dedup vs existing items in current turn
        const text = data.text as string | undefined;
        if (!text || !currentTurnId) break;

        const currentTurn = state.turns.find((t) => t.turnId === currentTurnId);
        if (!currentTurn) break;

        // Check if any UserMessageItem in current turn has same text
        const hasMatchingText = currentTurn.itemIds.some((id) => {
          const item = state.itemsById[id];
          return item && item.kind === "user" && item.text.trim() === text.trim();
        });

        if (!hasMatchingText) {
          const itemId = `user-${entry.ts}`;
          const userItem: UserMessageItem = {
            kind: "user",
            itemId,
            text,
            ts: entry.ts,
          };
          state.itemsById[itemId] = userItem;
          currentTurn.itemIds.push(itemId);
          state.itemOrder.push(itemId);
        }
        break;
      }

      case "turn.completed":
        if (currentTurnId) {
          const turn = state.turns.find((t) => t.turnId === currentTurnId);
          if (turn) {
            turn.endedAt = entry.ts;
          }
        }
        break;
    }
  }

  // Seed initial prompt if not already present
  if (initialPrompt && initialPrompt.trim()) {
    const promptTrimmed = initialPrompt.trim();
    const hasPromptItem = state.itemOrder.some((id) => {
      const item = state.itemsById[id];
      return (
        item && item.kind === "user" && item.text.toLowerCase() === promptTrimmed.toLowerCase()
      );
    });

    if (!hasPromptItem) {
      const seedItem: UserMessageItem = {
        kind: "user",
        itemId: "__seeded_prompt",
        text: initialPrompt,
        ts: 0,
      };
      state.itemsById["__seeded_prompt"] = seedItem;
      state.itemOrder.unshift("__seeded_prompt");

      // Add to first turn if exists, otherwise create a dummy turn
      if (state.turns.length > 0) {
        state.turns[0].itemIds.unshift("__seeded_prompt");
      } else {
        state.turns.push({
          turnId: "t0",
          startedAt: 0,
          endedAt: null,
          itemIds: ["__seeded_prompt"],
        });
      }
    }
  }

  return state;
}
