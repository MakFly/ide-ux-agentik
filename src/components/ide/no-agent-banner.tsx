import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { toast } from "sonner";

/**
 * Friendly HTML fallback shown inside the PTY view when the active workspace
 * is not a remote-agent. All text is native DOM — selectable, copy-able,
 * with dedicated copy buttons for the two commands users need.
 */

const AGENT_CMD = "bun run agent/server.ts --root ~/yourproject --port 7421 --token hello";
const WS_URL = "ws://localhost:7421";
const WS_TOKEN = "hello";

export function NoAgentBanner({ cmd }: { cmd?: string }) {
  return (
    <div className="scrollbar-visible h-full w-full select-text overflow-y-auto bg-black px-5 py-4 font-mono text-[12.5px] leading-6 text-foreground">
      <div className="flex items-center gap-2 text-status-warn">
        <Terminal className="h-3.5 w-3.5" />
        <span>No remote-agent workspace — cannot spawn {cmd ?? "shell"}</span>
      </div>

      <p className="mt-3 text-muted-foreground">
        To run real CLIs (codex, claude, opencode, gemini) you need a Bun agent on a machine
        reachable over WebSocket.
      </p>

      <ol className="mt-4 space-y-4">
        <li>
          <div className="flex items-center gap-2">
            <span className="text-syntax-type">1.</span>
            <span>Start the agent in another terminal:</span>
          </div>
          <CopyLine value={AGENT_CMD} />
        </li>

        <li>
          <div className="flex items-center gap-2">
            <span className="text-syntax-type">2.</span>
            <span>
              In the sidebar → <span className="text-syntax-keyword">+ New project</span> →{" "}
              <span className="text-syntax-keyword">Remote</span>:
            </span>
          </div>
          <div className="mt-2 grid grid-cols-[80px_1fr] gap-y-1.5 text-[12px]">
            <span className="text-muted-foreground">URL</span>
            <CopyLine value={WS_URL} dense />
            <span className="text-muted-foreground">Token</span>
            <CopyLine value={WS_TOKEN} dense />
          </div>
        </li>

        <li className="text-muted-foreground">
          <span className="text-syntax-type">3.</span> The new workspace is auto-selected. Open a
          CLI tab again.
        </li>
      </ol>

      <p className="mt-4 text-[11px] text-muted-foreground">
        💡 In real PTY sessions: <kbd className="font-mono">Ctrl+Shift+C</kbd> copies the
        selection, <kbd className="font-mono">Ctrl+Shift+V</kbd> pastes.
      </p>
    </div>
  );
}

function CopyLine({ value, dense }: { value: string; dense?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard denied — select the text and copy manually");
    }
  };
  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-border bg-code-bg/60 px-3 py-1.5 ${
        dense ? "" : "mt-2"
      }`}
    >
      <code className="flex-1 select-all overflow-x-auto whitespace-nowrap text-syntax-string">
        {value}
      </code>
      <button
        onClick={() => void onCopy()}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Copy"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-status-add" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
