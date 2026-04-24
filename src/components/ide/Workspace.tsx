import { useEffect, useMemo, useRef, useState } from "react";
import { X, FileCode, Plus, ChevronLeft, ChevronRight, LogIn } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useIDE,
  useCurrentActiveTab,
  useCurrentBranches,
  useCurrentOpenFiles,
  useCurrentTasks,
  useCurrentWorktree,
  useCurrentSessions,
  useActiveSession,
  type AgentTabId,
  type TabId,
  type TerminalKind,
  type WorkspaceTerminal,
  type Worktree,
  type FileTab,
} from "@/store/ide";
import { Thread } from "@/components/assistant-ui/thread";
import { AgentSessionView } from "@/components/ide/agent-session-view";
import { CodeEditor } from "@/components/ide/code-editor";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

const staticTabs: { id: AgentTabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Codebase Overview", icon: <span className="text-status-del">✦</span> },
  { id: "audit", label: "Codebase Perf Audit", icon: <span className="text-status-add">⬢</span> },
];

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

function FileView({
  tabId,
  path,
  content,
  loading,
  isBinary,
  isDirty,
  error,
  preview,
}: {
  tabId: `file:${string}`;
  path: string;
  content: string | null;
  loading?: boolean;
  isBinary?: boolean;
  isDirty?: boolean;
  error?: string;
  preview: boolean;
}) {
  const isMarkdown = path.endsWith(".md");
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-code-bg/40 px-6 py-2 font-mono text-[11.5px] text-muted-foreground">
        <span>{path}</span>
        {isDirty && !loading && content !== null && (
          <span className="text-status-warn" title="Unsaved changes">
            •
          </span>
        )}
        {!isDirty && !loading && content !== null && !isBinary && (
          <span className="text-status-add/70 text-[10px]" title="Saved">
            saved
          </span>
        )}
        {preview && isMarkdown && content !== null && (
          <span className="ml-2 text-primary">· preview</span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2 px-6 py-4">
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        </div>
      ) : isBinary ? (
        <div className="flex h-32 items-center justify-center text-[13px] text-muted-foreground">
          Binary file — preview not available.
        </div>
      ) : content === null ? (
        <div className="flex h-32 items-center justify-center text-[13px] text-status-del">
          {error ?? "Failed to load file."}
        </div>
      ) : preview && isMarkdown ? (
        <div className="scrollbar-visible flex-1 overflow-y-auto">
          <div className="markdown-preview max-w-3xl px-6 py-4 text-[14px] leading-6 text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor tabId={tabId} path={path} content={content} />
        </div>
      )}
    </div>
  );
}

function terminalStatusClass(status: WorkspaceTerminal["status"]) {
  if (status === "busy") return "bg-status-warn/15 text-status-warn";
  if (status === "idle") return "bg-muted text-muted-foreground";
  return "bg-status-add/15 text-status-add";
}

function TerminalView({
  terminal,
  workspaceName,
  branchName,
  worktree,
  taskCount,
}: {
  terminal: WorkspaceTerminal;
  workspaceName: string;
  branchName: string;
  worktree: Worktree;
  taskCount: number;
}) {
  return (
    <div className="scrollbar-visible h-full overflow-y-auto bg-code-bg/30 px-6 py-5 font-mono text-[12.5px] leading-6">
      <div className="text-syntax-comment">
        # {terminal.title} session — workspace: {workspaceName} — branch: {branchName}
      </div>
      <div className="mt-2">
        <span className="text-syntax-string">$</span> {terminal.lastCommand}
      </div>
      <div className="text-syntax-type">→ attaching PTY to {worktree.path}</div>
      <div className="text-syntax-type">→ worktree status: {worktree.status}</div>
      <div className="text-syntax-type">→ task queue: {taskCount} branch-linked task(s)</div>
      <div className="text-foreground">Ready. Type instructions in the composer below.</div>
      <div className="mt-3 text-syntax-comment">
        # context: active worktree "{worktree.name}" derived from the current branch scope
      </div>
      <div className="mt-1">
        <span className="text-syntax-keyword">async fn</span>{" "}
        <span className="text-syntax-fn">main</span>() {"{"}
      </div>
      <div className="pl-4">
        <span className="text-syntax-keyword">let</span> session ={" "}
        <span className="text-syntax-type">WorktreeSession</span>::
        <span className="text-syntax-fn">attach</span>( "{worktree.path}");
      </div>
      <div className="pl-4">
        session.<span className="text-syntax-fn">spawn_agent</span>("{terminal.kind}")?;
      </div>
      <div>{"}"}</div>
    </div>
  );
}

function AuditView({ branchName }: { branchName: string }) {
  const rows = [
    { metric: "Cold start", value: "412 ms", trend: "+3%", warn: false },
    { metric: "Frame time (p99)", value: "8.2 ms", trend: "-12%", warn: false },
    { metric: "Memory (idle)", value: "186 MB", trend: "+1%", warn: false },
    { metric: "Git refresh", value: "94 ms", trend: "+18%", warn: true },
    { metric: "PR poll", value: "1.2 s", trend: "stable", warn: false },
  ];
  return (
    <div className="px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-[22px] font-semibold">Codebase Perf Audit</h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          Latest benchmarks · {branchName} · 14h ago
        </p>
        <div className="mt-5 overflow-hidden rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-code-bg/60 text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Metric</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r, i) => (
                <tr key={r.metric} className={cn(i > 0 && "border-t border-border")}>
                  <td className="px-4 py-2.5 font-sans">{r.metric}</td>
                  <td className="px-4 py-2.5 text-syntax-num">{r.value}</td>
                  <td
                    className={cn("px-4 py-2.5", r.warn ? "text-status-warn" : "text-status-add")}
                  >
                    {r.trend}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OverviewView() {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      <div className="text-[13px] font-medium text-foreground">Codebase overview</div>
      <p className="max-w-md text-[12.5px] text-muted-foreground">
        Chat with the agent below. Open a file from the tree to edit it above the CLI.
      </p>
    </section>
  );
}

const AGENT_OPTIONS: { id: TerminalKind; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "gemini", label: "Gemini" },
];

function AgentCliTabs() {
  const sessions = useCurrentSessions();
  const activeSession = useActiveSession();
  const setActiveSession = useIDE((s) => s.setActiveSession);
  const closeAgentSession = useIDE((s) => s.closeAgentSession);
  const addAgentSession = useIDE((s) => s.addAgentSession);
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
      <div className="flex items-center justify-between border-b border-border bg-code-bg/40 px-3 py-1.5">
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
              <DropdownMenuItem key={a.id} onSelect={() => addAgentSession(a.id)}>
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
    <div className="flex flex-col border-b border-border bg-code-bg/40">
      <div className="flex items-center">
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
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeAgentSession(s.id);
                  }
                }}
                className={cn(
                  "group flex shrink-0 snap-start items-center gap-1.5 border-r border-border px-3 py-1.5 text-[11.5px]",
                  active
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                )}
              >
                <button
                  onClick={() => setActiveSession(s.id)}
                  className="flex items-center gap-1.5 font-medium"
                  title={`${s.title} · ${currentWorktree?.name ?? ""} · middle-click to close`}
                >
                  <ProductFavicon agent={s.kind} label={s.title} />
                  <span className="whitespace-nowrap">{s.title}</span>
                  <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                    @{workspaceName}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeAgentSession(s.id);
                  }}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  title="Close CLI"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex shrink-0 snap-start items-center gap-1 px-3 py-1.5 text-[11.5px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                title="Add CLI"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {AGENT_OPTIONS.map((a) => (
                <DropdownMenuItem key={a.id} onSelect={() => addAgentSession(a.id)}>
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
        <span className="shrink-0 px-3 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          CLI
        </span>
      </div>
      {sessions.length > 1 && (
        <div className="flex items-center justify-center gap-1 py-1">
          {sessions.map((s) => {
            const active = s.id === activeSession?.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSession(s.id)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  active
                    ? "w-4 bg-primary"
                    : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
                )}
                title={`${s.title} @${workspaceName}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Workspace() {
  const activeSession = useActiveSession();
  const sessions = useCurrentSessions();
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <AgentCliTabs />
      <div key={activeSession?.id ?? "no-session"} className="min-h-0 flex-1 overflow-hidden">
        {sessions.length === 0 || !activeSession ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <div className="text-[13px] font-medium text-foreground">No CLI running</div>
            <p className="max-w-sm text-[12.5px] text-muted-foreground">
              Start a new CLI session from the <span className="font-mono">+ New CLI</span> button
              above. Each session is bound to the current workspace.
            </p>
          </div>
        ) : (
          <AgentSessionView session={activeSession} />
        )}
      </div>
    </main>
  );
}

function WorkspaceLegacy() {
  const activeTab = useCurrentActiveTab();
  const setActiveTab = useIDE((s) => s.setActiveTab);
  const addTerminal = useIDE((s) => s.addTerminal);
  const workspaces = useIDE((s) => s.workspaces);
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const openFiles = useCurrentOpenFiles();
  const closeFile = useIDE((s) => s.closeFile);
  const previewMode = useIDE((s) => s.previewMode);
  const tasks = useCurrentTasks();
  const currentWorktree = useCurrentWorktree();
  const currentBranches = useCurrentBranches();
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const branch = currentBranches.find((b) => b.id === activeBranchId);
  const [closedTabs, setClosedTabs] = useState<string[]>([]);

  const terminalTabs = useMemo(
    () =>
      (currentWorktree?.terminals ?? []).map((terminal) => ({
        id: `terminal:${terminal.id}` as TabId,
        label: terminal.title,
        icon: <ProductFavicon agent={terminal.kind} label={terminal.title} />,
        terminal,
      })),
    [currentWorktree],
  );

  const visibleTabs = [...staticTabs, ...terminalTabs].filter(
    (tab) => !closedTabs.includes(tab.id),
  );
  const validTabIds = new Set<TabId>([
    "overview",
    "audit",
    ...terminalTabs.map((tab) => tab.id),
    ...openFiles.map((file) => file.id),
  ]);
  const resolvedTab = validTabIds.has(activeTab) ? activeTab : (terminalTabs[0]?.id ?? "overview");
  const activeFile = openFiles.find((f) => f.id === resolvedTab) as FileTab | undefined;
  const activeTerminal = resolvedTab.startsWith("terminal:")
    ? currentWorktree?.terminals.find((terminal) => `terminal:${terminal.id}` === resolvedTab)
    : undefined;

  const saveFile = useIDE((s) => s.saveFile);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [saveFile]);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center border-b border-border">
        <div className="scrollbar-none flex flex-1 items-center overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-[13px] transition-colors",
                resolvedTab === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setClosedTabs((current) => [...current, tab.id]);
                  if (resolvedTab === tab.id) {
                    const remaining = visibleTabs.filter((candidate) => candidate.id !== tab.id);
                    setActiveTab(remaining[0]?.id ?? "overview");
                  }
                }}
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </span>
              {resolvedTab === tab.id && (
                <span className="absolute inset-x-3 -bottom-px h-[2px] bg-primary" />
              )}
            </button>
          ))}
          {openFiles.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveTab(f.id)}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap border-l border-border px-4 py-2.5 text-[13px] transition-colors",
                resolvedTab === f.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileCode className="h-3.5 w-3.5 text-syntax-type" />
              <span className="font-mono">{f.path.split("/").pop()}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(f.id);
                }}
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </span>
              {resolvedTab === f.id && (
                <span className="absolute inset-x-3 -bottom-px h-[2px] bg-primary" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center px-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="New agent tab"
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(
                [
                  { kind: "codex", label: "Codex" },
                  { kind: "claude", label: "Claude Code" },
                  { kind: "opencode", label: "OpenCode" },
                  { kind: "gemini", label: "Gemini" },
                ] as const
              ).map(({ kind, label }) => (
                <DropdownMenuItem
                  key={kind}
                  onSelect={() => {
                    if (!currentWorktree) return;
                    const terminalId = addTerminal(currentWorktree.id, kind);
                    setActiveTab(`terminal:${terminalId}` as TabId);
                  }}
                  className="gap-2"
                >
                  <ProductFavicon agent={kind} label={label} />
                  <span>{label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelGroup orientation="vertical" id="workspace-split" className="flex h-full flex-col">
          <Panel
            defaultSize={activeFile ? 60 : 35}
            minSize={15}
            collapsible
            collapsedSize={0}
            className="flex min-h-0"
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeFile ? (
                <FileView
                  tabId={activeFile.id}
                  path={activeFile.path}
                  content={activeFile.content}
                  loading={activeFile.loading}
                  isBinary={activeFile.isBinary}
                  isDirty={activeFile.isDirty}
                  error={activeFile.error}
                  preview={previewMode}
                />
              ) : resolvedTab === "overview" ? (
                <OverviewView />
              ) : resolvedTab === "audit" ? (
                <AuditView branchName={branch?.name ?? "—"} />
              ) : activeTerminal && currentWorktree && workspace && branch ? (
                <TerminalView
                  terminal={activeTerminal}
                  workspaceName={workspace.name}
                  branchName={branch.name}
                  worktree={currentWorktree}
                  taskCount={tasks.length}
                />
              ) : (
                <OverviewView />
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="group relative h-2 shrink-0 cursor-row-resize transition-colors hover:bg-accent/40">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/60 group-hover:bg-primary/50" />
          </PanelResizeHandle>
          <Panel defaultSize={activeFile ? 40 : 65} minSize={20} className="flex min-h-0 flex-col">
            <AgentCliTabs />
            <div className="min-h-0 flex-1 overflow-hidden">
              <Thread />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </main>
  );
}
