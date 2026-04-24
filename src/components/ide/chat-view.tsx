import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { FlaskConical } from "lucide-react";
import { Thread } from "@/components/assistant-ui/thread";
import { codexAdapter } from "@/lib/chat/codex-adapter";
import type { WorkspaceSource } from "@/lib/fs";
import type { TerminalKind } from "@/store/ide";
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
  return <CodexChat kind={kind} sessionId={sessionId} workspaceSource={workspaceSource} />;
}

function CodexChat({
  kind,
  sessionId,
  workspaceSource,
}: {
  kind: TerminalKind;
  sessionId?: string;
  workspaceSource?: WorkspaceSource;
}) {
  const { messages: initialMessages, loading } = useSessionHistory(sessionId, workspaceSource);
  const runtime = useLocalRuntime(codexAdapter, { initialMessages });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 w-full flex-col">
        {kind !== "codex" && <ExperimentalBanner kind={kind} />}
        {loading && (
          <div className="border-b border-border bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
            Loading history…
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
        <span className="font-mono font-medium text-foreground">{kind}</span> chat is experimental
        — RPC adapter not fully wired. Use the Terminal tab for full CLI access.
      </span>
    </div>
  );
}
