import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, ChevronLeft, ChevronRight, LogIn, Pin, PinOff } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  useIDE,
  useCurrentWorktree,
  useCurrentSessions,
  useActiveSession,
  usePinnedSessionIds,
  type TerminalKind,
  type WorkspaceTerminal,
} from "@/store/ide";
import { Thread } from "@/components/assistant-ui/thread";
import {
  AgentSessionView,
  SessionModeToggle,
  type SessionMode,
} from "@/components/ide/agent-session-view";
import { KillSessionDialog } from "@/components/ide/kill-session-dialog";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const agentFaviconSrc: Record<TerminalKind, string> = {
  codex: "/agents/codex.svg",
  claude: "/agents/claude-code.svg",
  opencode: "/agents/opencode.ico",
  gemini: "/agents/gemini.svg",
};

function ProductFavicon({ agent, label }: { agent: TerminalKind; label: string }) {
  return (
    <img
      src={agentFaviconSrc[agent]}
      alt={`${label} favicon`}
      className={cn(
        "h-3.5 w-3.5 shrink-0 object-contain",
        agent === "codex" && "rounded-[4px] bg-white p-[1px]",
      )}
      loading="eager"
      decoding="async"
    />
  );
}

function sessionDotClass(status: WorkspaceTerminal["status"]) {
  if (status === "busy") return "bg-status-warn animate-pulse";
  if (status === "idle") return "bg-muted-foreground/50";
  return "bg-status-add";
}

const AGENT_OPTIONS: { id: TerminalKind; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "gemini", label: "Gemini" },
];

function AgentCliTabs({
  activeMode,
  onActiveModeChange,
}: {
  activeMode?: SessionMode;
  onActiveModeChange?: (m: SessionMode) => void;
}) {
  const sessions = useCurrentSessions();
  const activeSession = useActiveSession();
  const pinnedIds = usePinnedSessionIds();
  const setActiveSession = useIDE((s) => s.setActiveSession);
  const closeAgentSession = useIDE((s) => s.closeAgentSession);
  const openNewTaskDialog = useIDE((s) => s.openNewTaskDialog);
  const pinSession = useIDE((s) => s.pinSession);
  const unpinSession = useIDE((s) => s.unpinSession);
  const currentWorktree = useCurrentWorktree();
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const workspaceName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "—";

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [sessions.length]);

  useEffect(() => {
    if (!activeSession) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-session-id="${activeSession.id}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeSession?.id]);

  // Ctrl+Tab / Ctrl+Shift+Tab to cycle between sessions
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== "Tab") return;
      if (sessions.length < 2) return;
      e.preventDefault();
      const currentIdx = sessions.findIndex((s) => s.id === activeSession?.id);
      const dir = e.shiftKey ? -1 : 1;
      const nextIdx = (currentIdx + dir + sessions.length) % sessions.length;
      setActiveSession(sessions[nextIdx].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessions, activeSession?.id, setActiveSession]);

  const scrollBy = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 180, behavior: "smooth" });
  };

  if (sessions.length === 0) {
    return (
      <div className="flex items-center justify-between border-b border-border bg-code-bg/40 px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              title="Start a new CLI"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New CLI</span>
              <span className="font-mono text-[10px] text-muted-foreground">@{workspaceName}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {AGENT_OPTIONS.map((a) => (
              <DropdownMenuItem key={a.id} onSelect={() => openNewTaskDialog(a.id)}>
                <ProductFavicon agent={a.id} label={a.label} />
                <span>{a.label}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild>
              <Link to="/settings" search={{ login: "codex" }} viewTransition>
                <LogIn className="h-3.5 w-3.5 shrink-0" />
                <span>Sign in to Codex</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          CLI
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center border-b border-border bg-code-bg/40">
      {canScrollLeft && (
        <button
          onClick={() => scrollBy(-1)}
          className="flex h-full shrink-0 items-center border-r border-border px-1.5 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          title="Scroll left"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
      <div
        ref={scrollRef}
        className="scrollbar-none flex flex-1 items-center overflow-x-auto scroll-smooth snap-x snap-mandatory"
      >
        {sessions.map((s) => {
          const active = s.id === activeSession?.id;
          return (
            <div
              key={s.id}
              data-session-id={s.id}
              data-active={active}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeAgentSession(s.id);
                }
              }}
              className={cn(
                "group relative flex shrink-0 snap-start items-center gap-1.5 px-3 py-2.5 text-[11.5px] transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
              )}
            >
              {active && (
                <span className="pointer-events-none absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" />
              )}
              <button
                onClick={() => setActiveSession(s.id)}
                className="flex items-center gap-1.5 font-medium"
                title={`${s.title} · ${currentWorktree?.name ?? ""} · middle-click to close`}
              >
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sessionDotClass(s.status))}
                />
                <ProductFavicon agent={s.kind} label={s.title} />
                <span className="whitespace-nowrap">{s.title}</span>
                <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                  @{workspaceName}
                </span>
              </button>
              <KillSessionDialog
                session={s}
                trigger={
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    title="Close CLI"
                  >
                    <X className="h-3 w-3" />
                  </button>
                }
              />
              {s.id !== activeSession?.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pinnedIds.includes(s.id)) unpinSession(s.id);
                    else pinSession(s.id);
                  }}
                  className={cn(
                    "rounded p-0.5 transition-opacity hover:bg-accent hover:text-foreground",
                    pinnedIds.includes(s.id)
                      ? "text-primary opacity-100"
                      : "text-muted-foreground opacity-0 group-hover:opacity-100",
                  )}
                  title={pinnedIds.includes(s.id) ? "Unpin panel" : "Pin side by side"}
                >
                  {pinnedIds.includes(s.id) ? (
                    <PinOff className="h-3 w-3" />
                  ) : (
                    <Pin className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex shrink-0 snap-start items-center gap-1 px-3 py-2.5 text-[11.5px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              title="Add CLI"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {AGENT_OPTIONS.map((a) => (
              <DropdownMenuItem key={a.id} onSelect={() => openNewTaskDialog(a.id)}>
                <ProductFavicon agent={a.id} label={a.label} />
                <span>{a.label}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  @{workspaceName}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild>
              <Link to="/settings" search={{ login: "codex" }} viewTransition>
                <LogIn className="h-3.5 w-3.5 shrink-0" />
                <span>Sign in to Codex</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {canScrollRight && (
        <button
          onClick={() => scrollBy(1)}
          className="flex h-full shrink-0 items-center border-l border-border px-1.5 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          title="Scroll right"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
      {activeMode && onActiveModeChange && (
        <div className="shrink-0 border-l border-border/60 px-1">
          <SessionModeToggle mode={activeMode} onChange={onActiveModeChange} />
        </div>
      )}
    </div>
  );
}

export function Workspace() {
  const activeSession = useActiveSession();
  const sessions = useCurrentSessions();
  const pinnedIds = usePinnedSessionIds();
  const allSessions = useCurrentSessions();
  const [sessionModes, setSessionModes] = useState<Record<string, SessionMode>>({});
  const setMode = (id: string, m: SessionMode) => setSessionModes((prev) => ({ ...prev, [id]: m }));
  const modeOf = (id: string): SessionMode => sessionModes[id] ?? "chat";

  const pinnedSessions = useMemo(
    () =>
      pinnedIds
        .map((id) => allSessions.find((s) => s.id === id))
        .filter(Boolean) as WorkspaceTerminal[],
    [pinnedIds, allSessions],
  );

  const hasPinned = pinnedSessions.length > 0;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <AgentCliTabs
        activeMode={activeSession ? modeOf(activeSession.id) : undefined}
        onActiveModeChange={activeSession ? (m) => setMode(activeSession.id, m) : undefined}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {sessions.length === 0 || !activeSession ? (
          // Empty state: render the central composer (assistant-ui Thread) so the
          // user can type a prompt directly. Submit → taskLauncherAdapter →
          // store.createTaskFromPrompt → new task + session-tab in this Workspace.
          <Thread />
        ) : hasPinned ? (
          <PanelGroup orientation="horizontal" className="h-full">
            <Panel minSize={20} defaultSize={Math.round(100 / (pinnedSessions.length + 1))}>
              <AgentSessionView session={activeSession} mode={modeOf(activeSession.id)} />
            </Panel>
            {pinnedSessions.map((session) => (
              <Fragment key={session.id}>
                <PanelResizeHandle className="group relative w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40">
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-primary/60" />
                </PanelResizeHandle>
                <Panel minSize={20} defaultSize={Math.round(100 / (pinnedSessions.length + 1))}>
                  <AgentSessionView session={session} mode={modeOf(session.id)} />
                </Panel>
              </Fragment>
            ))}
          </PanelGroup>
        ) : (
          <AgentSessionView session={activeSession} mode={modeOf(activeSession.id)} />
        )}
      </div>
    </main>
  );
}
