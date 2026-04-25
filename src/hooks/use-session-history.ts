import { useEffect, useState } from "react";
import type { ThreadAssistantMessagePart, ThreadMessageLike } from "@assistant-ui/react";
import { providerFor, type WorkspaceSource } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { persistence } from "@/lib/persistence/client";
import type { DbMessage } from "@/lib/persistence/types";

const MAX_HISTORY_MESSAGES = 50;

type Part = {
  type: string;
  text?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};

function dbMessageToThreadMessage(msg: DbMessage): ThreadMessageLike | null {
  const role = msg.role as "user" | "assistant";
  if (role !== "user" && role !== "assistant") return null;

  let parts: Part[] = [];
  try {
    parts = JSON.parse(msg.parts_json) as Part[];
  } catch {
    return null;
  }

  if (role === "user") {
    const textParts = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => ({ type: "text" as const, text: p.text as string }));
    if (!textParts.length) return null;
    return {
      id: msg.id,
      role: "user",
      content: textParts,
      createdAt: new Date(msg.ts),
    };
  }

  // assistant: text + reasoning + already-resolved tool-call parts.
  // assistant-ui requires tool-call parts to have a matching tool-result; we
  // only re-inject those that already carry a `result` (synthetic tools like
  // "plan" always do — set by the adapter). Tool-calls without a result are
  // skipped to keep the runtime happy. Plan tool-calls are what restores the
  // <PlanStepList> UI (with Approve / Refine / Discard) on refresh — without
  // this, only the raw markdown text would survive.
  let synthCallId = 0;
  const content: ThreadAssistantMessagePart[] = [];
  for (const p of parts) {
    if (p.type === "text") {
      content.push({ type: "text", text: (p.text as string) ?? "" });
    } else if (p.type === "reasoning") {
      content.push({ type: "reasoning", text: (p.text as string) ?? "" });
    } else if (p.type === "tool-call" && typeof p.toolName === "string" && p.result !== undefined) {
      content.push({
        type: "tool-call",
        toolCallId: `restored-${msg.id}-${++synthCallId}`,
        toolName: p.toolName,
        args: (p.args as Record<string, unknown> | undefined) ?? {},
        argsText: JSON.stringify(p.args ?? {}),
        result: p.result,
        isError: p.isError === true,
      } as ThreadAssistantMessagePart);
    }
  }
  if (!content.length) return null;
  return {
    id: msg.id,
    role: "assistant",
    content,
    createdAt: new Date(msg.ts),
  };
}

export type SessionHistoryResult = {
  messages: ThreadMessageLike[];
  loading: boolean;
  error: Error | null;
};

export function useSessionHistory(
  sessionId: string | undefined,
  workspaceSource: WorkspaceSource | undefined,
  reloadToken: number = 0,
): SessionHistoryResult {
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sessionId || !workspaceSource || workspaceSource.kind !== "remote-agent") {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const provider = (await providerFor(
          workspaceSource,
          workspaceSource.label,
        )) as RemoteAgentProvider;
        await provider.connect();
        const rows = await persistence.messages.list(provider, sessionId);
        if (cancelled) return;

        const tail = rows.length > MAX_HISTORY_MESSAGES ? rows.slice(-MAX_HISTORY_MESSAGES) : rows;
        const mapped: ThreadMessageLike[] = [];
        for (const row of tail) {
          const msg = dbMessageToThreadMessage(row);
          if (msg) mapped.push(msg);
        }
        console.debug(
          "[persistence] session history loaded",
          sessionId,
          `${rows.length} rows → ${mapped.length} messages`,
        );
        setMessages(mapped);
      } catch (err) {
        console.warn("[persistence] messages.list failed", sessionId, err);
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, workspaceSource, reloadToken]);

  return { messages, loading, error };
}
