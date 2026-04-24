import { X } from "lucide-react";
import { useIDE, useCurrentScopeKey, useCurrentWorktree } from "@/store/ide";
import { PtyTerminal } from "@/components/ide/pty-terminal";

export function TerminalPanel() {
  const scope = useCurrentScopeKey();
  const currentWorktree = useCurrentWorktree();
  const worktreeName = currentWorktree?.name;
  const toggleTerminal = useIDE((s) => s.toggleTerminal);

  return (
    <div className="flex h-[240px] shrink-0 flex-col border-t border-border bg-black">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">
          terminal · {scope}
          {worktreeName ? ` · ${worktreeName}` : ""}
        </span>
        <button
          onClick={toggleTerminal}
          className="rounded p-1 hover:bg-accent hover:text-foreground"
          title="Close terminal"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <PtyTerminal
          injectCodexAuth
          injectCodexApiKey
          banner={[`\x1b[90m# terminal · scope ${scope}\x1b[0m`]}
        />
      </div>
    </div>
  );
}
