import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { FlaskConical } from "lucide-react";
import { Thread } from "@/components/assistant-ui/thread";
import { codexAdapter } from "@/lib/chat/codex-adapter";
import type { TerminalKind } from "@/store/ide";

export function ChatView({ kind }: { kind: TerminalKind }) {
  return <CodexChat kind={kind} />;
}

function CodexChat({ kind }: { kind: TerminalKind }) {
  const runtime = useLocalRuntime(codexAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 w-full flex-col">
        {kind !== "codex" && <ExperimentalBanner kind={kind} />}
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
