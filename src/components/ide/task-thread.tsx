"use client";

import { useEffect, useMemo } from "react";
import { useExternalStoreRuntime } from "@assistant-ui/core/react";
import { AssistantRuntimeProvider, type ThreadMessageLike } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { useIDE, type Workspace } from "@/store/ide";
import { RemoteAgentProvider, type Task, type TaskLogEntry } from "@/lib/fs/remote-agent";

const EMPTY_EVENTS: TaskLogEntry[] = [];

type Item = { id: string; role: "user" | "assistant"; text: string };

function eventToItems(entry: TaskLogEntry, cli: string): Item[] {
  const out: Item[] = [];
  if (entry.source === "stderr") {
    const text = typeof (entry.data as any)?.text === "string" ? (entry.data as any).text : "";
    if (text)
      out.push({
        id: `e${entry.id}-${entry.ts}`,
        role: "assistant",
        text: `\`\`\`\n${text}\n\`\`\``,
      });
    return out;
  }
  const d = entry.data as any;
  if (!d || typeof d !== "object") return out;

  if (cli === "codex") {
    if (d.type === "agent_message" || d.type === "assistant_message") {
      const text =
        typeof d.text === "string" ? d.text : typeof d.message === "string" ? d.message : "";
      if (text) out.push({ id: `e${entry.id}-${entry.ts}`, role: "assistant", text });
      return out;
    }
    if (d.type === "user_message") {
      const text =
        typeof d.text === "string" ? d.text : typeof d.message === "string" ? d.message : "";
      if (text) out.push({ id: `e${entry.id}-${entry.ts}`, role: "user", text });
      return out;
    }
    if (d.type === "item.completed") {
      const item = d.item ?? {};
      if (item.type === "reasoning" && typeof item.text === "string") {
        out.push({
          id: `e${entry.id}-${entry.ts}`,
          role: "assistant",
          text: `<details><summary>🧠 Reasoning</summary>\n\n${item.text}\n\n</details>`,
        });
        return out;
      }
      if (item.type === "assistant_message" && typeof item.text === "string") {
        out.push({ id: `e${entry.id}-${entry.ts}`, role: "assistant", text: item.text });
        return out;
      }
      if (item.type === "command_execution" && typeof item.command === "string") {
        const stdout = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
        const exit = typeof item.exit_code === "number" ? `\n_(exit ${item.exit_code})_` : "";
        out.push({
          id: `e${entry.id}-${entry.ts}`,
          role: "assistant",
          text: `\`\`\`bash\n$ ${item.command}\n\`\`\`\n${stdout ? `\`\`\`\n${stdout}\n\`\`\`` : ""}${exit}`,
        });
        return out;
      }
    }
    return out;
  }

  // claude stream-json
  if (cli === "claude") {
    if (d.type === "user") {
      const msg = d.message ?? {};
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
                .filter(Boolean)
                .join("\n")
            : "";
      if (text) out.push({ id: `e${entry.id}-${entry.ts}`, role: "user", text });
      return out;
    }
    if (d.type === "assistant") {
      const msg = d.message ?? {};
      const items = Array.isArray(msg.content) ? msg.content : [];
      for (const c of items) {
        if (c?.type === "thinking" && typeof c.thinking === "string") {
          out.push({
            id: `e${entry.id}-${entry.ts}-think${out.length}`,
            role: "assistant",
            text: `<details><summary>🧠 Thinking</summary>\n\n${c.thinking}\n\n</details>`,
          });
        }
      }
      const textParts = items
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text as string);
      if (textParts.length > 0) {
        out.push({ id: `e${entry.id}-${entry.ts}`, role: "assistant", text: textParts.join("\n") });
      }
      const toolCalls = items.filter((c: any) => c?.type === "tool_use");
      for (const tc of toolCalls) {
        out.push({
          id: `e${entry.id}-${entry.ts}-${tc.id ?? out.length}`,
          role: "assistant",
          text: `🛠 \`${tc.name ?? "tool"}\`\n\`\`\`json\n${JSON.stringify(tc.input ?? {}, null, 2)}\n\`\`\``,
        });
      }
      return out;
    }
    // skip system/hook events — they're noise
    return out;
  }

  return out;
}

export function TaskThread({ task, workspace }: { task: Task; workspace: Workspace }) {
  const loadTaskLogs = useIDE((s) => s.loadTaskLogs);
  const allTasks = useIDE((s) => s.tasksByWorkspaceId[workspace.id] ?? []);

  // Helper to resolve conversation root and collect all task ids
  const conversationTaskIds = useMemo<string[]>(() => {
    // Find conversation root.
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

    // Collect all tasks in the conversation (root + descendants).
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

  // Aggregate events from the conversation root and all descendants.
  // Subscribe to all event buffers for tasks in this conversation.
  const events = useIDE((s) => {
    const allEvents: TaskLogEntry[] = [];
    for (const taskId of conversationTaskIds) {
      const taskEvents = s.taskEventsByTaskId[taskId] ?? [];
      allEvents.push(...taskEvents);
    }
    allEvents.sort((a, b) => a.ts - b.ts);
    return allEvents;
  });

  // Re-fetch logs if empty (switch UX: ensures logs are reloaded on tab switch).
  useEffect(() => {
    if (events.length === 0) {
      void loadTaskLogs(task.id);
    }
  }, [task.id, events.length, loadTaskLogs]);

  // Flatten events to a stable Item list. Prepend the original prompt as the
  // first user message — task events don't replay it (codex/claude consume it
  // via stdin or CLI args).
  const items = useMemo<Item[]>(() => {
    const acc: Item[] = [{ id: "user-prompt", role: "user", text: task.prompt }];
    for (const e of events) {
      for (const it of eventToItems(e, task.cli)) acc.push(it);
    }
    return acc;
  }, [events, task.prompt, task.cli]);

  const isRunning = task.status === "running" || task.status === "queued";

  const runtime = useExternalStoreRuntime<Item>({
    messages: items,
    isRunning,
    convertMessage: (m) =>
      ({
        id: m.id,
        role: m.role,
        content: [{ type: "text", text: m.text }],
      }) as ThreadMessageLike,
    onNew: async (message) => {
      const text = message.content
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim();
      if (!text) return;
      if (workspace.source.kind !== "remote-agent") return;
      const provider = new RemoteAgentProvider(
        workspace.source.label,
        workspace.source.url,
        workspace.source.token,
      );
      await provider.connect();
      const baseRef = task.branchName ?? task.baseRef ?? "main";
      const { id: childId } = await provider.taskCreate({
        workspaceId: workspace.id,
        title: `Follow-up: ${text.split("\n")[0].slice(0, 50) || task.title}`,
        prompt: text,
        cli: task.cli,
        model: task.model ?? undefined,
        effort: task.effort ?? undefined,
        baseRef,
        parentSessionId: task.sessionId ?? undefined,
      });
      await provider.taskStart(childId);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex-1 min-h-0">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
