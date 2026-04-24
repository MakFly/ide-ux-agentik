import { PtyTerminal } from "@/components/ide/pty-terminal";
import { type TerminalKind, type WorkspaceTerminal } from "@/store/ide";

/**
 * Spawns the actual agent CLI in a PTY bound to this session. Each session gets
 * its own xterm instance and PTY process; switching tabs remounts the component
 * via the `resetKey` = session.id, killing the previous PTY cleanly.
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

const ARGS_BY_KIND: Record<TerminalKind, string[] | undefined> = {
  codex: undefined,
  claude: undefined,
  opencode: undefined,
  gemini: undefined,
};

export function AgentSessionView({ session }: { session: WorkspaceTerminal }) {
  const isCodex = session.kind === "codex";
  return (
    <div className="flex h-full flex-col bg-black">
      <div className="border-b border-border px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
        {session.kind} · {session.title}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <PtyTerminal
          cmd={CMD_BY_KIND[session.kind]}
          args={ARGS_BY_KIND[session.kind]}
          injectCodexAuth={isCodex}
          injectCodexApiKey={isCodex}
          resetKey={session.id}
          banner={[`\x1b[90m# ${session.kind} session · ${session.id}\x1b[0m`]}
        />
      </div>
    </div>
  );
}
