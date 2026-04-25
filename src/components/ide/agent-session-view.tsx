import { MessageSquare, Terminal as TerminalIcon, X, Plus } from "lucide-react";
import { useState } from "react";
import { PtyTerminal } from "@/components/ide/pty-terminal";
import { TaskConversation } from "@/components/ide/task-conversation";
import { codexExtraArgs } from "@/lib/chat/models";
import { cn } from "@/lib/utils";
import { useIDE, type TerminalKind, type WorkspaceTerminal } from "@/store/ide";
import type { WorkspaceSource } from "@/lib/fs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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

const AGENT_OPTIONS: Array<{ value: TerminalKind; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "opencode", label: "OpenCode" },
  { value: "gemini", label: "Gemini" },
];

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
  const [activeSubTabSessionId, setActiveSubTabSessionId] = useState<string>(session.id);
  const codexModel = useIDE((s) => s.codexModel);
  const isCodex = session.kind === "codex";
  const workspace = useIDE((s) => s.workspaces.find((w) => w.id === session.workspaceId));
  const workspaceSource = workspace?.source as WorkspaceSource | undefined;

  const taskId = session.taskRootId || session.taskId;
  const task = useIDE((s) => {
    if (!taskId) return null;
    const list = s.tasksByWorkspaceId[session.workspaceId] ?? [];
    return list.find((t) => t.id === taskId) ?? null;
  });

  const attachCliToActiveTask = useIDE((s) => s.attachCliToActiveTask);
  const detachCliFromTask = useIDE((s) => s.detachCliFromTask);
  const allSessions = useIDE((s) => s.sessionsByWorkspaceId[session.workspaceId] ?? []);

  // Get CLI sessions for this task
  const cliSessions = session.cliSessions ?? [session.id];
  const showSubTabs = cliSessions.length > 1;

  // Get session details for sub-tabs
  const sessionList = cliSessions
    .map((sid) => allSessions.find((s) => s.id === sid))
    .filter(Boolean) as WorkspaceTerminal[];

  // Determine active sub-tab session (fallback to primary if needed)
  const activeSession =
    sessionList.find((s) => s.id === activeSubTabSessionId) ?? sessionList[0] ?? session;

  return (
    <div className="flex h-full flex-col bg-black">
      {/* Sub-tabs strip for multi-CLI tasks */}
      {showSubTabs && (
        <div className="flex items-center gap-1 border-b border-border bg-background/40 px-2 py-1">
          {sessionList.map((s, idx) => {
            const isPrimary = idx === 0;
            return (
              <div
                key={s.id}
                className="flex items-center gap-0.5 rounded border border-border/50 bg-background/60 px-2 py-1"
              >
                <button
                  onClick={() => setActiveSubTabSessionId(s.id)}
                  className={cn(
                    "text-[11px] font-medium transition-colors",
                    activeSession.id === s.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title={`${s.kind} session`}
                >
                  {s.kind}
                </button>
                {!isPrimary && (
                  <button
                    onClick={() => void detachCliFromTask(s.id)}
                    className="ml-1 flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
                    title="Detach session"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <Plus className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {AGENT_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => void attachCliToActiveTask(opt.value)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Both panels stay MOUNTED across mode toggles — otherwise switching
          Chat → Terminal → Chat would destroy the assistant-ui runtime and
          wipe the conversation, and the PTY would re-spawn every time. We
          only hide the inactive one via `hidden`. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={cn("h-full w-full", mode !== "chat" && "hidden")}>
          {task && workspace ? (
            <TaskConversation key={activeSession.id} task={task} workspace={workspace} />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              Task not found — session may have been removed.
            </div>
          )}
        </div>
        <div className={cn("h-full w-full", mode !== "terminal" && "hidden")}>
          <PtyTerminal
            cmd={CMD_BY_KIND[activeSession.kind]}
            args={argsFor(activeSession.kind, codexModel)}
            injectCodexAuth={activeSession.kind === "codex"}
            injectCodexApiKey={activeSession.kind === "codex"}
            resetKey={activeSession.id}
            banner={[`\x1b[90m# ${activeSession.kind} session · ${activeSession.id}\x1b[0m`]}
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
