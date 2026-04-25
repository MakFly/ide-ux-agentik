/**
 * Lightweight unit tests for codex-conversation-reducer.
 *
 * Note: vitest is not currently configured. These tests can be run
 * after vitest setup, or the e2e suite exercises the reducer end-to-end.
 */

import { reduceCodexEvents } from "../codex-conversation-reducer";
import type { TaskLogEntry } from "@/lib/fs/remote-agent";

// Helper to create a TaskLogEntry
function entry(ts: number, type: string, data: Record<string, unknown>): TaskLogEntry {
  return {
    id: 1,
    taskId: "task-1",
    ts,
    level: "info",
    source: "stdout",
    data: { type, ...data },
  };
}

describe("codex-conversation-reducer", () => {
  it("should handle reasoning streaming: item.started + deltas + item.completed", () => {
    const events: TaskLogEntry[] = [
      entry(100, "turn.started", {}),
      entry(101, "item.started", {
        item: { id: "item_0", type: "reasoning" },
      }),
      entry(102, "reasoning", { text: "Let ", delta: true }),
      entry(103, "reasoning", { text: "me ", delta: true }),
      entry(104, "reasoning", { text: "think", delta: true }),
      entry(105, "item.completed", {
        item: { id: "item_0", type: "reasoning", text: "Let me think" },
      }),
      entry(106, "turn.completed", {}),
    ];

    const state = reduceCodexEvents(events, "");

    // Should have 1 item
    expect(Object.keys(state.itemsById)).toHaveLength(1);
    const item = state.itemsById["item_0"];
    expect(item?.kind).toBe("reasoning");
    if (item.kind === "reasoning") {
      expect(item.text).toBe("Let me think");
      expect(item.completedAt).toBe(105);
      expect(item.durationMs).toBe(105 - 101);
    }
  });

  it("should dedup: top-level assistant_message with same text as item.completed", () => {
    const events: TaskLogEntry[] = [
      entry(100, "turn.started", {}),
      entry(101, "item.started", {
        item: { id: "item_1", type: "assistant_message" },
      }),
      entry(102, "item.completed", {
        item: {
          id: "item_1",
          type: "assistant_message",
          text: "Here are the files",
        },
      }),
      entry(103, "assistant_message", { text: "Here are the files" }),
      entry(104, "turn.completed", {}),
    ];

    const state = reduceCodexEvents(events, "");

    // Should have 1 item only (deduped)
    expect(state.itemOrder).toHaveLength(1);
    const item = state.itemsById["item_1"];
    expect(item?.kind).toBe("assistant_text");
    if (item.kind === "assistant_text") {
      expect(item.text).toBe("Here are the files");
    }
  });

  it("should seed initial prompt if not present in events", () => {
    const events: TaskLogEntry[] = [
      entry(100, "turn.started", {}),
      entry(101, "item.started", {
        item: { id: "item_1", type: "assistant_message" },
      }),
      entry(102, "item.completed", {
        item: {
          id: "item_1",
          type: "assistant_message",
          text: "Done",
        },
      }),
    ];

    const state = reduceCodexEvents(events, "list files");

    // Should have seeded prompt + assistant message
    expect(state.itemOrder).toHaveLength(2);
    const seedItem = state.itemsById["__seeded_prompt"];
    expect(seedItem?.kind).toBe("user");
    if (seedItem.kind === "user") {
      expect(seedItem.text).toBe("list files");
    }
  });

  it("should handle tool execution: command_execution item", () => {
    const events: TaskLogEntry[] = [
      entry(100, "turn.started", {}),
      entry(101, "item.started", {
        item: {
          id: "item_0",
          type: "command_execution",
          command: "ls -la",
        },
      }),
      entry(102, "item.completed", {
        item: {
          id: "item_0",
          type: "command_execution",
          command: "ls -la",
          aggregated_output: "total 42\n-rw-r--r--",
          exit_code: 0,
          status: "completed",
        },
      }),
      entry(103, "turn.completed", {}),
    ];

    const state = reduceCodexEvents(events, "");

    expect(state.itemOrder).toHaveLength(1);
    const item = state.itemsById["item_0"];
    expect(item?.kind).toBe("tool_call");
    if (item.kind === "tool_call") {
      expect(item.toolName).toBe("exec");
      expect(item.command).toBe("ls -la");
      expect(item.exitCode).toBe(0);
      expect(item.output).toBe("total 42\n-rw-r--r--");
      expect(item.status).toBe("completed");
    }
  });

  it("should mark tool as failed when exit_code !== 0", () => {
    const events: TaskLogEntry[] = [
      entry(100, "turn.started", {}),
      entry(101, "item.started", {
        item: {
          id: "item_0",
          type: "command_execution",
          command: "false",
        },
      }),
      entry(102, "item.completed", {
        item: {
          id: "item_0",
          type: "command_execution",
          command: "false",
          aggregated_output: "",
          exit_code: 1,
          status: "failed",
        },
      }),
    ];

    const state = reduceCodexEvents(events, "");

    const item = state.itemsById["item_0"];
    if (item.kind === "tool_call") {
      expect(item.status).toBe("failed");
      expect(item.exitCode).toBe(1);
    }
  });

  it("should not seed prompt if already present (case-insensitive)", () => {
    const events: TaskLogEntry[] = [
      entry(100, "turn.started", {}),
      entry(101, "user_message", { text: "List Files" }),
      entry(102, "turn.completed", {}),
    ];

    const state = reduceCodexEvents(events, "list files");

    // Should have 1 item only (no duplicate seed)
    expect(state.itemOrder).toHaveLength(1);
  });

  it("should build turn.itemIds in order of appearance", () => {
    const events: TaskLogEntry[] = [
      entry(100, "turn.started", {}),
      entry(101, "item.started", {
        item: { id: "item_0", type: "reasoning" },
      }),
      entry(102, "item.completed", {
        item: { id: "item_0", type: "reasoning", text: "hmm" },
      }),
      entry(103, "item.started", {
        item: { id: "item_1", type: "command_execution", command: "ls" },
      }),
      entry(104, "item.completed", {
        item: {
          id: "item_1",
          type: "command_execution",
          aggregated_output: "file.txt",
          exit_code: 0,
        },
      }),
      entry(105, "assistant_message", { text: "Here it is" }),
      entry(106, "turn.completed", {}),
    ];

    const state = reduceCodexEvents(events, "");

    const turn = state.turns[0];
    expect(turn.itemIds).toEqual(["item_0", "item_1", expect.any(String)]);
    expect(state.itemOrder).toHaveLength(3);
  });
});
