import { MessageSquare, Terminal as TerminalIcon } from "lucide-react";
import { ChatView } from "@/components/ide/chat-view";
import { PtyTerminal } from "@/components/ide/pty-terminal";
import { codexExtraArgs } from "@/lib/chat/models";
import { cn } from "@/lib/utils";
import { useIDE, type TerminalKind, type WorkspaceTerminal } from "@/store/ide";
import type { WorkspaceSource } from "@/lib/fs";

/**
 * Two modes per agent session:
 *   - "chat" (default): `codex exec --json` via chat.spawn RPC → assistant-ui
 *     Thread. Non-interactive, structured events (text / reasoning / tools).
 *   - "terminal": legacy PTY (xterm) — still the only way to run device-auth
 *     logins, approvals, or drive the native TUI.
 *
 * Command matrix — keep aligned with what's installed on the agent host:
 *   codex     → `codex`
 *   claude    → `claude`
 *   opencode  → `opencode`
 *   gemini    → `gemini`
 */

const CMD_BY_KIND: Record<TerminalKind, string> = {
  codex: "codex",
  claude: "claude",
  opencode: "opencode",
  gemini: "gemini",
};

/** Per-kind CLI args are derived from the store (user-selected model, etc.). */
function argsFor(kind: TerminalKind, codexModel: string | undefined): string[] | undefined {
  if (kind === "codex") return codexExtraArgs(codexModel);
  // claude / opencode / gemini: model selection wired in v2.
  return undefined;
}

export type SessionMode = "chat" | "terminal";

export function AgentSessionView({
  session,
  mode = "chat",
}: {
  session: WorkspaceTerminal;
  mode?: SessionMode;
}) {
  const codexModel = useIDE((s) => s.codexModel);
  const isCodex = session.kind === "codex";
  const workspaceSource = useIDE(
    (s) =>
      s.workspaces.find((w) => w.id === session.workspaceId)?.source as WorkspaceSource | undefined,
  );

  return (
    <div className="flex h-full flex-col bg-black">
      {/* Both panels stay MOUNTED across mode toggles — otherwise switching
          Chat → Terminal → Chat would destroy the assistant-ui runtime and
          wipe the conversation, and the PTY would re-spawn every time. We
          only hide the inactive one via `hidden`. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={cn("h-full w-full", mode !== "chat" && "hidden")}>
          <ChatView
            key={session.id}
            kind={session.kind}
            sessionId={session.id}
            workspaceSource={workspaceSource}
          />
        </div>
        <div className={cn("h-full w-full", mode !== "terminal" && "hidden")}>
          <PtyTerminal
            cmd={CMD_BY_KIND[session.kind]}
            args={argsFor(session.kind, codexModel)}
            injectCodexAuth={isCodex}
            injectCodexApiKey={isCodex}
            resetKey={session.id}
            banner={[`\x1b[90m# ${session.kind} session · ${session.id}\x1b[0m`]}
          />
        </div>
      </div>
    </div>
  );
}

export function SessionModeToggle({
  mode,
  onChange,
}: {
  mode: SessionMode;
  onChange: (m: SessionMode) => void;
}) {
  return (
    <div className="flex items-center">
      <ModeButton
        active={mode === "chat"}
        onClick={() => onChange("chat")}
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        label="Chat"
      />
      <ModeButton
        active={mode === "terminal"}
        onClick={() => onChange("terminal")}
        icon={<TerminalIcon className="h-3.5 w-3.5" />}
        label="Terminal"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground/70 hover:text-foreground hover:bg-accent/40",
      )}
    >
      {icon}
    </button>
  );
}
