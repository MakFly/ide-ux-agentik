/**
 * Pure reducer: TaskLogEntry[] → ConversationState for Claude (stream-json).
 *
 * Rules:
 * - system events → skip (noise)
 * - user { message: { content } } → UserMessageItem
 * - assistant { message: { content: [...] } }:
 *   - type:"thinking" → ReasoningItem
 *   - type:"text" → AssistantTextItem
 *   - type:"tool_use" → ToolCallItem (running, no output yet)
 * - user { message: { content: [{ type:"tool_result", tool_use_id, content }] } }
 *   → patch ToolCallItem with output, mark completed
 * - result → close turn
 *
 * No turn delimiter from Claude — synthesize: each assistant/user event with
 * a new message_id starts a new turn if needed. For simplicity, put all items
 * in a single turn; turn.endedAt = result.ts.
 */

import type { TaskLogEntry } from "@/lib/fs/remote-agent";
import type {
  AssistantTextItem,
  ConversationState,
  ReasoningItem,
  ToolCallItem,
  UserMessageItem,
} from "./conversation-types";

export function reduceClaudeEvents(
  events: TaskLogEntry[],
  initialPrompt: string,
): ConversationState {
  const state: ConversationState = {
    turns: [],
    itemsById: {},
    itemOrder: [],
  };

  // For Claude, we use a single synthetic turn for simplicity
  const turnId = "t0";
  state.turns.push({
    turnId,
    startedAt: 0,
    endedAt: null,
    itemIds: [],
  });

  const currentTurn = state.turns[0];

  for (const entry of events) {
    const data = entry.data as Record<string, unknown>;
    const type = data.type as string | undefined;

    // Skip system events
    if (type === "system") {
      continue;
    }

    if (type === "user") {
      const message = data.message as Record<string, unknown> | undefined;
      if (!message) continue;

      const content = message.content as unknown[];
      if (!Array.isArray(content)) continue;

      for (const c of content) {
        const cObj = c as Record<string, unknown>;
        const cType = cObj.type as string | undefined;

        if (cType === "text") {
          const text = cObj.text as string | undefined;
          if (text) {
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
        } else if (cType === "tool_result") {
          // Patch existing ToolCallItem with this tool_use_id
          const toolUseId = cObj.tool_use_id as string | undefined;
          const resultContent = cObj.content as (Record<string, unknown> | string)[] | undefined;

          if (toolUseId) {
            // Find the ToolCallItem with matching tool_use_id in itemsById
            let found = false;
            for (const key in state.itemsById) {
              const item = state.itemsById[key];
              if (item.kind === "tool_call" && item.itemId === toolUseId) {
                // Merge output from resultContent
                const outputs: string[] = [];
                if (Array.isArray(resultContent)) {
                  for (const rc of resultContent) {
                    if (typeof rc === "string") {
                      outputs.push(rc);
                    } else if (typeof rc === "object" && rc !== null) {
                      const rcObj = rc as Record<string, unknown>;
                      if (typeof rcObj.text === "string") {
                        outputs.push(rcObj.text);
                      }
                    }
                  }
                }
                item.output = outputs.join("\n");
                item.status = "completed";
                item.completedAt = entry.ts;
                found = true;
                break;
              }
            }
          }
        }
      }
    } else if (type === "assistant") {
      const message = data.message as Record<string, unknown> | undefined;
      if (!message) continue;

      const content = message.content as unknown[];
      if (!Array.isArray(content)) continue;

      for (const c of content) {
        const cObj = c as Record<string, unknown>;
        const cType = cObj.type as string | undefined;

        if (cType === "thinking") {
          const thinking = cObj.thinking as string | undefined;
          if (thinking) {
            const itemId = `thinking-${entry.ts}`;
            const reasoningItem: ReasoningItem = {
              kind: "reasoning",
              itemId,
              text: thinking,
              startedAt: entry.ts,
              completedAt: entry.ts,
              durationMs: 0,
            };
            state.itemsById[itemId] = reasoningItem;
            currentTurn.itemIds.push(itemId);
            state.itemOrder.push(itemId);
          }
        } else if (cType === "text") {
          const text = cObj.text as string | undefined;
          if (text) {
            const itemId = `assistant-text-${entry.ts}`;
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
        } else if (cType === "tool_use") {
          const toolName = cObj.name as string | undefined;
          const toolInput = cObj.input as unknown;
          const toolId = cObj.id as string | undefined;

          if (toolName && toolId) {
            const toolItem: ToolCallItem = {
              kind: "tool_call",
              itemId: toolId,
              toolName,
              input: toolInput,
              status: "running",
              exitCode: null,
              startedAt: entry.ts,
              completedAt: null,
            };
            state.itemsById[toolId] = toolItem;
            currentTurn.itemIds.push(toolId);
            state.itemOrder.push(toolId);
          }
        }
      }
    } else if (type === "result") {
      // Close the turn
      currentTurn.endedAt = entry.ts;
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
      currentTurn.itemIds.unshift("__seeded_prompt");
    }
  }

  return state;
}
