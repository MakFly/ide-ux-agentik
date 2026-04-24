import { useEffect, useState } from "react";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { providerFor, type WorkspaceSource } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { persistence } from "@/lib/persistence/client";
import type { DbMessage } from "@/lib/persistence/types";

const MAX_HISTORY_MESSAGES = 50;

type Part = { type: string; text?: string; toolName?: string; args?: unknown; result?: unknown; isError?: boolean };

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

  // assistant: text + reasoning parts only (tool-call parts are skipped in v1
  // because re-injecting them as ThreadMessageLike requires a matching tool-result
  // in the same message, which assistant-ui enforces at runtime).
  const content = parts
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p) => ({
      type: p.type as "text" | "reasoning",
      text: (p.text as string) ?? "",
    }));
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
        const provider = (await providerFor(workspaceSource, workspaceSource.label)) as RemoteAgentProvider;
        await provider.connect();
        const rows = await persistence.messages.list(provider, sessionId);
        if (cancelled) return;

        // Keep only the last MAX_HISTORY_MESSAGES, ordered chronologically.
        const tail = rows.length > MAX_HISTORY_MESSAGES ? rows.slice(-MAX_HISTORY_MESSAGES) : rows;
        // TODO: if tail.length === MAX_HISTORY_MESSAGES and rows.length > MAX_HISTORY_MESSAGES,
        //       consider adding a "history truncated" indicator in the Thread.

        const mapped: ThreadMessageLike[] = [];
        for (const row of tail) {
          const msg = dbMessageToThreadMessage(row);
          if (msg) mapped.push(msg);
        }
        setMessages(mapped);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, workspaceSource]);

  return { messages, loading, error };
}
