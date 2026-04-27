import { type ChatModelAdapter } from "@assistant-ui/react";
import { useEffect, useRef } from "react";
import { z } from "zod";
import type { TabId } from "@/store/ide";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopBar } from "@/components/ide/TopBar";
import { Sidebar } from "@/components/ide/Sidebar";
import { Workspace } from "@/components/ide/Workspace";
import { FilesPanel } from "@/components/ide/FilesPanel";
import { StatusBar } from "@/components/ide/StatusBar";
import { TerminalPanel } from "@/components/ide/terminal-panel";
import { EditorPanel } from "@/components/ide/editor-panel";
import {
  useIDE,
  useCurrentActiveTab,
  useCurrentOpenFiles,
  useActiveAgentThread,
} from "@/store/ide";
import { MOCK_ENABLED } from "@/lib/env";
import { TaskDetailDialog } from "@/components/ide/task-detail-dialog";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useIsMobile } from "@/hooks/use-mobile";

type AgentKind = "claude" | "codex" | "opencode" | "gemini";

function agentBanner(kind: AgentKind, scope: string): string {
  switch (kind) {
    case "claude":
      return `**Claude Code** · ${scope} · sonnet-4.6\n\n_Tip: /help, /effort, /plan, Ctrl+R for history_`;
    case "codex":
      return `**Codex CLI** · ${scope} · gpt-5-codex\n\n_Full-screen TUI · Plan mode · streaming diffs_`;
    case "opencode":
      return `**OpenCode** · ${scope} · provider: anthropic/claude-sonnet-4\n\n_Multi-provider · LSP · multi-session_`;
    case "gemini":
      return `**Gemini CLI** · ${scope} · gemini-2.5-pro\n\n_1M ctx · Google Search grounding · free tier_`;
  }
}

function agentBody(kind: AgentKind, text: string, webSearch: boolean, thinking: boolean): string {
  const snippet = text.slice(0, 80) || "(empty)";
  switch (kind) {
    case "claude":
      return [
        thinking ? `\n\n🧠 **Thinking** · decomposing "${snippet}" …` : "",
        `\n\n**Tool calls**`,
        `\n- 🔍 \`Glob\` — pattern \`**/*.ts\``,
        `\n- 📖 \`Read\` — \`src/store/ide.ts\` (1 406 lines)`,
        `\n- ✏️ \`Edit\` — queued, awaiting confirmation`,
        `\n\nReplying: "${snippet}"`,
      ].join("");
    case "codex":
      return [
        `\n\n\`\`\`diff`,
        `\n+ 1. Read repo structure`,
        `\n+ 2. Identify changes required for: ${snippet}`,
        `\n+ 3. Draft patch → preview → apply`,
        `\n\`\`\``,
        `\n\n_Plan ready. Say \`go\` to execute._`,
      ].join("");
    case "opencode":
      return [
        `\n\n\`\`\`bash`,
        `\n$ opencode session: #42 · model switched to gpt-5-mini`,
        `\n$ lsp: typescript server → 4 diagnostics`,
        `\n\`\`\``,
        `\n\nProposing: "${snippet}"`,
      ].join("");
    case "gemini":
      return [
        webSearch ? `\n\n🌐 **Google Search grounding** · 3 sources queried` : "",
        `\n\n📄 Context window: 1M tokens · using 12 342 (1.2%)`,
        `\n\nAnalysing: "${snippet}"`,
      ].join("");
  }
}

function getActiveSessionKind(): AgentKind {
  const state = useIDE.getState();
  const workspaceId = state.activeWorkspaceId;
  const sessions = state.sessionsByWorkspaceId[workspaceId] ?? [];
  const activeSessionId = state.activeSessionIdByWorkspaceId[workspaceId];
  const session = sessions.find((t) => t.id === activeSessionId) ?? sessions[0];
  return (session?.kind as AgentKind) ?? state.activeAgent;
}

const MockModelAdapter: ChatModelAdapter = {
  async run({ messages }) {
    const last = messages[messages.length - 1];
    const text = last?.content?.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? "";
    const {
      webSearch,
      thinking,
      activeWorkspaceId,
      activeBranchId,
      workspaces,
      branchesByWorkspaceId,
    } = useIDE.getState();
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
    const branch = (branchesByWorkspaceId[activeWorkspaceId] ?? []).find(
      (b) => b.id === activeBranchId,
    );
    const scope = `\`${workspace?.name ?? "?"}:${branch?.name ?? "?"}\``;
    const kind = getActiveSessionKind();
    await new Promise((r) => setTimeout(r, thinking ? 900 : 400));

    return {
      content: [
        {
          type: "text",
          text: agentBanner(kind, scope) + agentBody(kind, text, webSearch, thinking),
        },
      ],
    };
  },
};

const agentTabSchema = z.enum(["codex", "claude", "opencode", "gemini", "overview", "audit"]);
const fileTabSchema = z.string().regex(/^file:/);
const terminalTabSchema = z.string().regex(/^terminal:/);
const tabSchema = z.union([agentTabSchema, terminalTabSchema, fileTabSchema]);

const searchSchema = z.object({
  workspace: z.string().optional(),
  branch: z.string().optional(),
  tab: tabSchema.optional(),
  // Back-compat: ?task= is still accepted, but store -> URL writes ?thread=.
  task: z.string().optional(),
  thread: z.string().optional(),
});

export type IdeShellSearch = z.infer<typeof searchSchema>;

interface IdeShellProps {
  search?: IdeShellSearch;
  onNavigate?: (search: Record<string, unknown>) => void;
}

export function IdeShell({ search = {}, onNavigate }: IdeShellProps) {
  const hydratedFromUrlRef = useRef(false);

  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const activeThread = useActiveAgentThread();
  const applyingFromUrl = useIDE((s) => s.applyingFromUrl);
  const activeTab = useCurrentActiveTab();
  const setActiveBranch = useIDE((s) => s.setActiveBranch);
  const setActiveWorkspace = useIDE((s) => s.setActiveWorkspace);
  const setActiveTab = useIDE((s) => s.setActiveTab);
  const setActiveTask = useIDE((s) => s.setActiveTask);
  const setActiveThread = useIDE((s) => s.setActiveThread);
  const setApplyingFromUrl = useIDE((s) => s.setApplyingFromUrl);
  const hydrateTasks = useIDE((s) => s.hydrateTasks);
  const branchesByWorkspaceId = useIDE((s) => s.branchesByWorkspaceId);
  const workspaces = useIDE((s) => s.workspaces);
  const showTerminal = useIDE((s) => s.showTerminal);

  const { workspace, branch, tab, task, thread } = search;
  const requestedThreadId = thread ?? task;
  const requestedWorkspaceMissing = Boolean(
    workspace && workspaces.length > 0 && !workspaces.some((w) => w.id === workspace),
  );
  const hydratingThreadFromUrl = Boolean(
    requestedThreadId &&
    !requestedWorkspaceMissing &&
    (!hydratedFromUrlRef.current || applyingFromUrl),
  );

  // URL → store, once on mount.
  useEffect(() => {
    if (hydratedFromUrlRef.current) return;

    const applyFromUrl = async () => {
      const workspaceReady = !workspace || workspaces.some((w) => w.id === workspace);

      if (!workspaceReady) {
        return;
      }

      hydratedFromUrlRef.current = true;
      setApplyingFromUrl(true);
      if (workspace && workspace !== activeWorkspaceId) {
        setActiveWorkspace(workspace);
      }

      const resolvedWorkspaceId = workspace ?? activeWorkspaceId;
      if (branch && branch !== activeBranchId) {
        const branches = resolvedWorkspaceId ? branchesByWorkspaceId[resolvedWorkspaceId] : [];
        const existsInWorkspace = branches?.some((b) => b.id === branch) ?? false;
        const existsAnywhere = !resolvedWorkspaceId
          ? Object.values(branchesByWorkspaceId).some((wsBranches) =>
              wsBranches.some((b) => b.id === branch),
            )
          : false;
        if (existsInWorkspace || existsAnywhere) {
          setActiveBranch(branch);
        }
      }

      if (tab) setActiveTab(tab as TabId);

      if (thread) {
        if (resolvedWorkspaceId) {
          await hydrateTasks(resolvedWorkspaceId).catch(() => {});
        }
        setActiveThread(thread);
      } else if (task) {
        if (resolvedWorkspaceId) {
          await hydrateTasks(resolvedWorkspaceId).catch(() => {});
          const exists = (useIDE.getState().tasksByWorkspaceId[resolvedWorkspaceId] ?? []).some(
            (entry) => entry.id === task,
          );
          if (!exists) {
            console.warn(
              `[ide-shell] task ${task} not in workspace ${resolvedWorkspaceId} after hydrate`,
            );
          }
          setActiveTask(task);
        } else {
          setActiveTask(task);
        }
      }

      queueMicrotask(() => setApplyingFromUrl(false));
    };

    void applyFromUrl();
  }, [
    workspace,
    branch,
    tab,
    task,
    thread,
    activeWorkspaceId,
    activeBranchId,
    hydrateTasks,
    branchesByWorkspaceId,
    workspaces,
    setActiveTask,
    setActiveThread,
    setActiveBranch,
    setActiveWorkspace,
    setActiveTab,
    setApplyingFromUrl,
  ]);

  // store → URL, continuous (shallow replace to keep history clean).
  useEffect(() => {
    if (!hydratedFromUrlRef.current) return;
    const applying = useIDE.getState().applyingFromUrl;
    if (applying) return;
    if (onNavigate) {
      onNavigate({
        workspace:
          MOCK_ENABLED && activeWorkspaceId === "ws-sc"
            ? undefined
            : activeWorkspaceId || undefined,
        branch: MOCK_ENABLED && activeBranchId === "b1" ? undefined : activeBranchId || undefined,
        tab: activeTab === "overview" ? undefined : activeTab,
        thread: activeThread?.id ?? undefined,
      });
    }
  }, [activeWorkspaceId, activeBranchId, activeTab, activeThread?.id, onNavigate]);

  const taskDetailDialogTaskId = useIDE((s) => s.taskDetailDialogTaskId);
  const setTaskDetailDialogOpen = useIDE((s) => s.setTaskDetailDialogOpen);
  const tasksByWorkspaceId = useIDE((s) => s.tasksByWorkspaceId);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  void activeWorkspace; // kept for parity with the old dialog mount; harmless

  const currentTask = taskDetailDialogTaskId
    ? Object.values(tasksByWorkspaceId)
        .flat()
        .find((t) => t.id === taskDetailDialogTaskId)
    : null;
  const taskWorkspace = currentTask
    ? workspaces.find((w) => w.id === currentTask.workspaceId)
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-svh w-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar />
        <div className="flex min-h-0 flex-1 overflow-hidden bg-sidebar p-2">
          <ResizableLayout hydratingThreadFromUrl={hydratingThreadFromUrl} />
        </div>
        {showTerminal && <TerminalPanel />}
        <StatusBar />
        {currentTask && taskWorkspace && (
          <TaskDetailDialog
            task={currentTask}
            workspace={taskWorkspace}
            open={!!taskDetailDialogTaskId}
            onOpenChange={(open) => setTaskDetailDialogOpen(open ? taskDetailDialogTaskId : null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function ResizableLayout({ hydratingThreadFromUrl }: { hydratingThreadFromUrl: boolean }) {
  const isMobile = useIsMobile();
  const openFiles = useCurrentOpenFiles();
  const hasOpenFile = openFiles.length > 0;
  const showSidebar = useIDE((s) => s.showSidebar);
  const showFiles = useIDE((s) => s.showFiles);

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        <Workspace hydratingThreadFromUrl={hydratingThreadFromUrl} />
      </div>
    );
  }

  const layoutId = `ide-layout-${showSidebar ? "s" : ""}${showFiles ? "f" : ""}${hasOpenFile ? "e" : ""}`;
  const workspaceDefault = hasOpenFile
    ? showSidebar && showFiles
      ? "32%"
      : "48%"
    : showSidebar && showFiles
      ? "66%"
      : showSidebar || showFiles
        ? "82%"
        : "100%";

  return (
    <PanelGroup orientation="horizontal" id={layoutId} className="flex min-h-0 flex-1">
      {showSidebar && (
        <>
          <Panel defaultSize="16%" minSize="180px" maxSize="30%" className="flex min-w-0">
            <Sidebar />
          </Panel>
          <PanelResizeHandle className="group relative w-2 shrink-0 cursor-col-resize transition-colors hover:bg-accent/40">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/60 group-hover:bg-primary/50" />
          </PanelResizeHandle>
        </>
      )}
      <Panel defaultSize={workspaceDefault} minSize="320px" className="flex min-w-0">
        <Workspace hydratingThreadFromUrl={hydratingThreadFromUrl} />
      </Panel>
      {hasOpenFile && (
        <>
          <PanelResizeHandle className="group relative w-2 shrink-0 cursor-col-resize transition-colors hover:bg-accent/40">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/60 group-hover:bg-primary/50" />
          </PanelResizeHandle>
          <Panel defaultSize="34%" minSize="320px" className="flex min-w-0">
            <EditorPanel />
          </Panel>
        </>
      )}
      {showFiles && (
        <>
          <PanelResizeHandle className="group relative w-2 shrink-0 cursor-col-resize transition-colors hover:bg-accent/40">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/60 group-hover:bg-primary/50" />
          </PanelResizeHandle>
          <Panel defaultSize="18%" minSize="200px" maxSize="35%" className="flex min-w-0">
            <FilesPanel />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
