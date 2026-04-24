import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { FlaskConical } from "lucide-react";
import { Thread } from "@/components/assistant-ui/thread";
import { codexAdapter } from "@/lib/chat/codex-adapter";
import type { WorkspaceSource } from "@/lib/fs";
import { useIDE, type TerminalKind } from "@/store/ide";
import { useSessionHistory } from "@/hooks/use-session-history";

export function ChatView({
  kind,
  sessionId,
  workspaceSource,
}: {
  kind: TerminalKind;
  sessionId?: string;
  workspaceSource?: WorkspaceSource;
}) {
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const clearTick = useIDE((s) => s.sessionClearTickByWorkspace[activeWorkspaceId] ?? 0);

  const { messages, loading, error } = useSessionHistory(sessionId, workspaceSource);

  // Mount the runtime only once history has loaded. useLocalRuntime consumes
  // initialMessages at creation time only; mounting earlier with an empty
  // array freezes the thread as blank even after the async fetch resolves.
  if (loading) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        {kind !== "codex" && <ExperimentalBanner kind={kind} />}
        <div className="flex-1 min-h-0 flex items-center justify-center text-[11px] text-muted-foreground">
          Loading history…
        </div>
      </div>
    );
  }

  // `key` includes clearTick: incrementing it forces React to remount CodexChat
  // (and its AssistantRuntimeProvider) with an empty initialMessages array,
  // giving us a clean-slate thread without touching the PTY process.
  return (
    <CodexChat
      key={`${sessionId ?? "none"}-${clearTick}`}
      kind={kind}
      initialMessages={clearTick === 0 ? messages : []}
      error={error}
    />
  );
}

function CodexChat({
  kind,
  initialMessages,
  error,
}: {
  kind: TerminalKind;
  initialMessages: ThreadMessageLike[];
  error: Error | null;
}) {
  const runtime = useLocalRuntime(codexAdapter, { initialMessages });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 w-full flex-col">
        {kind !== "codex" && <ExperimentalBanner kind={kind} />}
        {error && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-[11px] text-destructive">
            Failed to load history: {error.message}
          </div>
        )}
        <div className="flex-1 min-h-0">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}

function ExperimentalBanner({ kind }: { kind: TerminalKind }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        <span className="font-mono font-medium text-foreground">{kind}</span> chat is experimental —
        RPC adapter not fully wired. Use the Terminal tab for full CLI access.
      </span>
    </div>
  );
}
