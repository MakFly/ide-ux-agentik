import { useEffect, useLayoutEffect, useRef, useState, type FC, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Send, User, Bot, Wrench, AlertTriangle, Terminal as TermIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useIDE, type Workspace } from "@/store/ide";
import { RemoteAgentProvider, type Task, type TaskLogEntry } from "@/lib/fs/remote-agent";

// ─── Renderer types ──────────────────────────────────────────────────────

type RenderedItem = {
  key: string;
  kind: "user" | "assistant" | "tool_use" | "tool_result" | "error" | "stderr" | "raw" | "system";
  title?: string;
  text?: string;
  meta?: string;
};

function getString(o: unknown, ...keys: string[]): string | undefined {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function jsonExcerpt(o: unknown, max = 240): string {
  let s: string;
  try {
    s = JSON.stringify(o);
  } catch {
    s = String(o);
  }
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function renderEntry(entry: TaskLogEntry, cli: string): RenderedItem | null {
  if (entry.source === "stderr") {
    const text = getString(entry.data, "text") ?? jsonExcerpt(entry.data);
    return { key: `e${entry.id}-${entry.ts}`, kind: "stderr", text };
  }
  if (entry.source === "spawn") {
    const text = getString(entry.data, "message") ?? jsonExcerpt(entry.data);
    return { key: `e${entry.id}-${entry.ts}`, kind: "error", title: "spawn error", text };
  }

  const data = entry.data;
  if (!data || typeof data !== "object") {
    return { key: `e${entry.id}-${entry.ts}`, kind: "raw", text: jsonExcerpt(data) };
  }

  const d = data as Record<string, unknown>;
  const type = typeof d.type === "string" ? (d.type as string) : "";

  // Claude stream-json (`--output-format stream-json --verbose`)
  if (cli === "claude") {
    if (type === "system") {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "system",
        title: "session",
        meta: getString(d, "subtype", "session_id"),
      };
    }
    if (type === "user") {
      const msg = (d.message as Record<string, unknown> | undefined) ?? {};
      const content = msg.content;
      let text: string | undefined;
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        const parts = (content as unknown[])
          .map((c) =>
            typeof c === "string"
              ? c
              : c && typeof c === "object" && "text" in (c as object)
                ? String((c as { text?: unknown }).text)
                : "",
          )
          .filter(Boolean);
        text = parts.join("\n");
      }
      return { key: `e${entry.id}-${entry.ts}`, kind: "user", text };
    }
    if (type === "assistant") {
      const msg = (d.message as Record<string, unknown> | undefined) ?? {};
      const content = msg.content;
      const items: RenderedItem[] = [];
      if (Array.isArray(content)) {
        for (const c of content as unknown[]) {
          if (!c || typeof c !== "object") continue;
          const cc = c as Record<string, unknown>;
          if (cc.type === "text" && typeof cc.text === "string") {
            items.push({
              key: `e${entry.id}-${entry.ts}-${items.length}`,
              kind: "assistant",
              text: cc.text as string,
            });
          } else if (cc.type === "tool_use") {
            items.push({
              key: `e${entry.id}-${entry.ts}-${items.length}`,
              kind: "tool_use",
              title: typeof cc.name === "string" ? cc.name : "tool",
              text: jsonExcerpt(cc.input ?? {}),
            });
          }
        }
      } else if (typeof content === "string") {
        items.push({ key: `e${entry.id}-${entry.ts}`, kind: "assistant", text: content });
      }
      // Return only the first; in practice content rarely has > 1 part split inline
      return items[0] ?? null;
    }
    if (type === "tool_result") {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "tool_result",
        title: getString(d, "tool_use_id") ?? "result",
        text: jsonExcerpt(d.content ?? d.output ?? d),
      };
    }
    if (type === "result") {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "system",
        title: "completed",
        meta: typeof d.duration_ms === "number" ? `${d.duration_ms}ms` : undefined,
      };
    }
    return { key: `e${entry.id}-${entry.ts}`, kind: "raw", text: jsonExcerpt(d) };
  }

  // Codex `exec --json` events
  if (cli === "codex") {
    if (type === "agent_message" || type === "assistant_message") {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "assistant",
        text: getString(d, "text", "message") ?? jsonExcerpt(d),
      };
    }
    if (type === "user_message") {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "user",
        text: getString(d, "text", "message"),
      };
    }
    if (type === "tool_call" || type === "function_call" || type === "exec_command_begin") {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "tool_use",
        title: getString(d, "name", "command", "tool") ?? "tool",
        text: jsonExcerpt(d.arguments ?? d.args ?? d.cmd ?? {}),
      };
    }
    if (
      type === "tool_call_result" ||
      type === "function_call_output" ||
      type === "exec_command_end"
    ) {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "tool_result",
        title: getString(d, "name", "tool") ?? "result",
        text: jsonExcerpt(d.output ?? d.result ?? d.stdout ?? d),
      };
    }
    if (type === "thread.started" || type === "task_started" || type === "session.update") {
      return { key: `e${entry.id}-${entry.ts}`, kind: "system", title: type };
    }
    if (type === "error") {
      return {
        key: `e${entry.id}-${entry.ts}`,
        kind: "error",
        title: "error",
        text: getString(d, "message") ?? jsonExcerpt(d),
      };
    }
    return { key: `e${entry.id}-${entry.ts}`, kind: "raw", text: jsonExcerpt(d) };
  }

  return { key: `e${entry.id}-${entry.ts}`, kind: "raw", text: jsonExcerpt(d) };
}

// ─── Visual ──────────────────────────────────────────────────────────────

const KIND_STYLE: Record<RenderedItem["kind"], { Icon: typeof Bot; ring: string; label: string }> =
  {
    user: { Icon: User, ring: "bg-primary/15 text-primary", label: "you" },
    assistant: { Icon: Bot, ring: "bg-accent text-foreground", label: "assistant" },
    tool_use: { Icon: Wrench, ring: "bg-status-warn/15 text-status-warn", label: "tool" },
    tool_result: { Icon: Wrench, ring: "bg-muted text-muted-foreground", label: "result" },
    error: { Icon: AlertTriangle, ring: "bg-destructive/15 text-destructive", label: "error" },
    stderr: { Icon: TermIcon, ring: "bg-destructive/10 text-destructive", label: "stderr" },
    raw: { Icon: TermIcon, ring: "bg-muted text-muted-foreground", label: "raw" },
    system: { Icon: TermIcon, ring: "bg-muted text-muted-foreground", label: "system" },
  };

const Bubble: FC<{ item: RenderedItem }> = ({ item }) => {
  const style = KIND_STYLE[item.kind];
  const Icon = style.Icon;
  return (
    <div className="flex gap-2 px-3 py-2">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          style.ring,
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[10.5px] uppercase tracking-wide text-muted-foreground">
          <span>{style.label}</span>
          {item.title && (
            <span className="font-mono normal-case text-foreground/70">{item.title}</span>
          )}
          {item.meta && (
            <span className="font-mono normal-case text-foreground/40">· {item.meta}</span>
          )}
        </div>
        {item.text && (
          <pre
            className={cn(
              "mt-0.5 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-snug",
              item.kind === "tool_use" || item.kind === "tool_result" || item.kind === "raw"
                ? "font-mono text-muted-foreground"
                : item.kind === "stderr" || item.kind === "error"
                  ? "font-mono text-destructive"
                  : "font-sans text-foreground",
            )}
          >
            {item.text}
          </pre>
        )}
      </div>
    </div>
  );
};

// ─── Container ───────────────────────────────────────────────────────────

const EMPTY_EVENTS: TaskLogEntry[] = [];

export const TaskTranscript: FC<{
  task: Task;
  workspace: Workspace;
  onChildDispatched?: (childTaskId: string) => void;
}> = ({ task, workspace, onChildDispatched }) => {
  // Stable reference for the empty case — `?? []` would create a new array
  // every render and trigger React's "maximum update depth" guard via
  // useSyncExternalStore.
  const events = useIDE((s) => s.taskEventsByTaskId[task.id] ?? EMPTY_EVENTS);
  const loadTaskLogs = useIDE((s) => s.loadTaskLogs);

  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Pull historical logs once when the transcript is first viewed.
  useEffect(() => {
    void loadTaskLogs(task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Stick-to-bottom while the user hasn't scrolled up.
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    if (isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = dist < 24;
  };

  const items = events
    .map((e) => renderEntry(e, task.cli))
    .filter((x): x is RenderedItem => x !== null);

  const sendFollowUp = async () => {
    const prompt = followUp.trim();
    if (!prompt) {
      toast.error("Type your follow-up first");
      return;
    }
    if (workspace.source.kind !== "remote-agent") return;
    setBusy(true);
    try {
      const provider = new RemoteAgentProvider(
        workspace.source.label,
        workspace.source.url,
        workspace.source.token,
      );
      await provider.connect();
      const baseRef = task.branchName ?? task.baseRef ?? "main";
      const { id } = await provider.taskCreate({
        workspaceId: workspace.id,
        title: `Follow-up: ${prompt.split("\n")[0].slice(0, 50) || task.title}`,
        prompt,
        cli: task.cli,
        model: task.model ?? undefined,
        effort: task.effort ?? undefined,
        baseRef,
        parentSessionId: task.sessionId ?? undefined,
      });
      await provider.taskStart(id);
      toast.success("Follow-up dispatched");
      setFollowUp("");
      onChildDispatched?.(id);
    } catch (err) {
      console.error("[TaskTranscript] follow-up failed:", err);
      toast.error(err instanceof Error ? err.message : "Follow-up dispatch failed");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void sendFollowUp();
    }
  };

  const isRunning = task.status === "running";
  const empty = items.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card"
      >
        {empty ? (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            {isRunning
              ? "Task is running — events will appear here as they stream."
              : task.status === "queued" || task.status === "awaiting"
                ? "Task hasn't started yet."
                : "No transcript stored for this task."}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {items.map((item) => (
              <Bubble key={item.key} item={item} />
            ))}
            {isRunning && (
              <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-status-warn" />
                Streaming…
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Send a follow-up… (creates a child task on this branch · ⌘↵)"
          rows={2}
          disabled={busy}
          className="min-h-[44px] flex-1 resize-none text-[12.5px]"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void sendFollowUp()}
          disabled={busy || !followUp.trim()}
          className="h-9 gap-1.5"
        >
          {busy ? (
            <span className="block h-3 w-3 animate-spin rounded-full border border-transparent border-t-current" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Follow-up
        </Button>
      </div>
    </div>
  );
};
