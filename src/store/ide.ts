import { useMemo } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { toast } from "sonner";
import { providerFor, FsError, type FsEntry } from "@/lib/fs";
import { computeStatus, type GitStatusMap } from "@/lib/git/status";
import { persistence } from "@/lib/persistence/client";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { MOCK_ENABLED } from "@/lib/env";
import { storage } from "@/lib/storage";

export type BranchStatus = "active" | "warn" | "loading" | "dot" | "none";

export type Branch = {
  id: string;
  name: string;
  age: string;
  added?: number;
  removed?: number;
  status?: BranchStatus;
  starred?: boolean;
};

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

// Renamed from BranchTask — tasks now scoped to worktrees, not branches.
export type WorkTask = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee: string;
  updatedAt: string;
};

// Backward-compat alias so existing UI consumers still compile.
export type BranchTask = WorkTask;

export type TerminalKind = "codex" | "claude" | "opencode" | "gemini";

export type WorkspaceTerminal = {
  id: string;
  kind: TerminalKind;
  title: string;
  status: "ready" | "busy" | "idle";
  workspaceId: string;
  // Optional: a session may be attached to a specific worktree, but by default it is workspace-scoped.
  worktreeId?: string;
  lastCommand: string;
  // When set, this session was spawned by a task and the panel renders
  // <TaskTranscript /> instead of ChatView. Invariant since Wave 1+2:
  // task.sessionId === WorkspaceTerminal.id, so taskId is the link back to
  // the parent task row.
  taskId?: string;
};

export type Worktree = {
  id: string;
  workspaceId: string;
  branchId: string;
  name: string;
  path: string;
  baseBranch: string;
  status: "ready" | "dirty" | "syncing";
  locked?: boolean;
  terminals: WorkspaceTerminal[];
};

export type WorkspaceSource =
  | { kind: "mock"; id: string }
  | { kind: "local-web"; handleId: string; name: string }
  | { kind: "remote-agent"; url: string; token: string; label: string };

// Workspace no longer carries branches — they live in branchesByWorkspaceId.
export type Workspace = {
  id: string;
  letter: string;
  name: string;
  color: string;
  gitUrl?: string;
  rootPath?: string;
  source: WorkspaceSource;
  orgId: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
};

export type AgentTabId = "codex" | "claude" | "opencode" | "gemini" | "overview" | "audit";
export type TerminalTabId = `terminal:${string}`;
export type TabId = AgentTabId | TerminalTabId | `file:${string}`;

export type FileTab = {
  id: `file:${string}`;
  path: string;
  content: string | null;
  loading?: boolean;
  isDirty?: boolean;
  isBinary?: boolean;
  error?: string;
};

const BINARY_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "bmp",
  "pdf",
  "zip",
  "tar",
  "gz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "webm",
  "wav",
  "flac",
  "ogg",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "wasm",
  "bin",
  "so",
  "dylib",
  "dll",
  "exe",
]);

function isBinaryPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXT.has(ext);
}

export type ScopeKey = `${string}:${string}`;
export const scopeKey = (ws: string, br: string): ScopeKey => `${ws}:${br}` as ScopeKey;

export type TreeNode = {
  path: string;
  name: string;
  type: "dir" | "file";
  children?: TreeNode[];
  loaded?: boolean;
};

export type Theme = "light" | "dark";

const DEFAULT_THEME: Theme = "dark";
const THEME_STORAGE_KEY = "ide-theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : DEFAULT_THEME;
}

function writeStoredTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

type State = {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeBranchId: string;
  currentOrgId: string | null;

  // Normalized branch storage — replaces Workspace.branches (denormalized).
  branchesByWorkspaceId: Record<string, Branch[]>;

  // activeBranchId per workspace — remembered on workspace switch.
  activeBranchIdByWorkspaceId: Record<string, string>;

  // Tasks keyed by worktree (was: branchId). DO NOT touch ScopeKey-keyed fields below.
  tasksByWorktreeId: Record<string, WorkTask[]>;

  // Tasks keyed by workspaceId — for remote-agent tasks UI.
  tasksByWorkspaceId: Record<string, import("@/lib/fs/remote-agent").Task[]>;
  activeTaskId: string | null;
  /** Task detail dialog open state. When set, the TaskDetailDialog opens on the Transcript tab. */
  taskDetailDialogTaskId: string | null;
  /** Singleton NewTaskDialog open state. Sidebar + and Workspace + New CLI both pipe into it. */
  newTaskDialogOpen: boolean;

  // Live event buffer for the per-task transcript viewer. Cap is enforced
  // in the buffering reducer below (2000 entries / task).
  taskEventsByTaskId: Record<string, import("@/lib/fs/remote-agent").TaskLogEntry[]>;

  // Client-side soft-delete tombstones. When the user removes a task we
  // record its id here so that it stays hidden even if the agent failed to
  // delete the SQLite row (e.g. running an older agent build). Persisted to
  // localStorage so it survives refresh.
  dismissedTaskIds: string[];

  // Messages keyed by sessionId (was: messagesByScope keyed by ScopeKey).
  messagesBySessionId: Record<string, ChatMessage[]>;

  // These remain ScopeKey-keyed — kept as-is to avoid touching file/tree consumers.
  openFilesByScope: Record<ScopeKey, FileTab[]>;
  activeTabByScope: Record<ScopeKey, TabId>;
  expandedFoldersByScope: Record<ScopeKey, Record<string, boolean>>;
  activeWorktreeIdByScope: Record<ScopeKey, string>;
  treeByScope: Record<ScopeKey, TreeNode>;
  loadingPaths: Record<ScopeKey, Record<string, boolean>>;
  gitStatusByScope: Record<ScopeKey, GitStatusMap>;

  worktreesByWorkspaceId: Record<string, Worktree[]>;
  sessionsByWorkspaceId: Record<string, WorkspaceTerminal[]>;
  activeSessionIdByWorkspaceId: Record<string, string>;
  pinnedSessionIdsByWorkspaceId: Record<string, string[]>;
  /** Incremented by tickClearSession() to force ChatView remount with empty history. */
  sessionClearTickByWorkspace: Record<string, number>;

  // Runtime-only (not persisted): Keep providers alive for task event listeners.
  agentProvidersByWorkspaceId: Record<string, RemoteAgentProvider>;

  // Global prefs
  theme: Theme;
  showFiles: boolean;
  showSidebar: boolean;
  showTerminal: boolean;
  showAgentPanel: boolean;
  applyingFromUrl: boolean;
  activeAgent: TerminalKind;
  previewMode: boolean;
  filesTab: "files" | "changes" | "checks";
  settingsSidebarCollapsed: boolean;
  thinking: boolean;
  webSearch: boolean;
  codexApiKey?: string;
  claudeApiKey?: string;
  /** Codex --model override. `undefined` = use codex's own default. */
  codexModel?: string;
  /** Per-CLI selected model. Key = TerminalKind, value = model id. */
  selectedModelByCli: Record<string, string>;
  /** Per-CLI approval mode. Key = TerminalKind, value = ApprovalMode. Default "confirm". */
  approvalModeByCli: Record<string, "auto" | "confirm" | "sandbox">;
  /** Claude context window override. `undefined` = auto from model. */
  claudeContextOverride?: "200k" | "1m";
  /** Last usage figures per CLI, captured at end of each adapter turn. */
  lastUsageByCli: Record<string, { inputTokens: number; outputTokens: number; ts: number }>;
  codexAuth?: {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    lastRefresh: string; // ISO
    email?: string;
    chatgptPlanType?: string;
    chatgptAccountId?: string;
  };

  branchesLoading: boolean;
  worktreesLoading: boolean;
  tasksLoading: boolean;
  fileTreeLoading: boolean;
  sessionsLoading: boolean;
  _hydrated: boolean;
  hydrate: () => void;

  // Flat legacy fields — kept for retrocompat with FilesPanel (consumers exist, do not remove).
  fileTree: Record<string, string[]>;
  rootFiles: string[];

  refreshGitStatus: (scopeKey: ScopeKey) => Promise<void>;

  // Async file/tree actions — kept untouched from previous version.
  loadRoot: (scopeKey: ScopeKey) => Promise<void>;
  loadChildren: (scopeKey: ScopeKey, path: string) => Promise<void>;
  createEntry: (
    scopeKey: ScopeKey,
    parentPath: string,
    name: string,
    type: "dir" | "file",
  ) => Promise<void>;
  removeEntry: (scopeKey: ScopeKey, path: string) => Promise<void>;

  setActiveWorkspace: (id: string) => void;
  setActiveBranch: (id: string) => void;
  setActiveTab: (id: TabId) => void;
  setActiveWorktree: (id: string) => void;
  toggleFolder: (name: string) => void;
  toggleFiles: () => void;
  toggleSidebar: () => void;
  toggleSettingsSidebar: () => void;
  toggleTerminal: () => void;
  toggleAgentPanel: () => void;
  setApplyingFromUrl: (v: boolean) => void;
  setActiveAgent: (k: TerminalKind) => void;
  setActiveSession: (sessionId: string) => void;
  addAgentSession: (kind: TerminalKind) => void;
  closeAgentSession: (sessionId: string) => void;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;
  setCodexApiKey: (key: string) => void;
  setClaudeApiKey: (key: string) => void;
  setCodexModel: (model: string | undefined) => void;
  setModelForCli: (cli: string, model: string) => void;
  setApprovalMode: (cli: string, mode: "auto" | "confirm" | "sandbox") => void;
  setClaudeContextOverride: (override: "200k" | "1m" | undefined) => void;
  setLastUsage: (cli: string, inputTokens: number, outputTokens: number) => void;
  setCodexAuth: (auth: State["codexAuth"] | null) => void;
  refreshCodexTokens: () => Promise<boolean>;
  togglePreview: () => void;
  setTheme: (t: Theme) => void;
  setFilesTab: (t: "files" | "changes" | "checks") => void;
  toggleThinking: () => void;
  toggleWebSearch: () => void;
  sendMessage: (content: string) => void;
  addBranch: (workspaceId: string, name: string) => void;
  toggleStar: (branchId: string) => void;
  addWorkspace: (
    name: string,
    source?: WorkspaceSource,
    opts?: { rootPath?: string; gitUrl?: string },
  ) => string;
  addTask: (worktreeId: string, title: string, description?: string) => void;
  updateTask: (
    worktreeId: string,
    taskId: string,
    patch: { title?: string; description?: string },
  ) => void;
  removeTask: (worktreeId: string, taskId: string) => void;
  cycleTaskStatus: (worktreeId: string, taskId: string) => void;
  setTaskStatus: (worktreeId: string, taskId: string, status: TaskStatus) => void;
  addWorktree: (workspaceId: string, branchId: string, name?: string) => void;
  addTerminal: (worktreeId: string, kind: TerminalKind) => string;
  pinSessionToWorktree: (sessionId: string, worktreeId: string | null) => void;
  /** Bump the clear-tick for workspaceId → forces ChatView to remount with empty history. */
  tickClearSession: (workspaceId: string) => void;

  // Cascade removal helpers — available as store actions, not wired to UI.
  removeWorktree: (worktreeId: string) => void;
  removeBranch: (workspaceId: string, branchId: string) => void;
  removeWorkspace: (workspaceId: string) => void;

  createFolder: (name: string) => void;
  createFile: (folder: string | null, name: string) => void;
  deleteEntry: (folder: string | null, name: string) => void;
  openFile: (path: string) => void;
  closeFile: (id: `file:${string}`) => void;
  saveFile: (tabId?: TabId) => Promise<void>;
  updateFileContent: (tabId: `file:${string}`, content: string) => void;

  getWorkspaceIdForBranch: (branchId: string) => string | undefined;
  hydrateSessionsFromDb: () => Promise<void>;
  setCurrentOrgId: (id: string) => void;
  hydrateWorkspacesFromStorage: (orgId: string) => Promise<void>;

  hydrateTasks: (workspaceId: string) => Promise<void>;
  loadTaskLogs: (taskId: string) => Promise<void>;
  setActiveTask: (id: string | null) => void;
  setTaskDetailDialogOpen: (taskId: string | null) => void;
  /** Open the singleton NewTaskDialog. If `prefillCli` is given, set activeAgent so the dialog defaults to that CLI. */
  openNewTaskDialog: (prefillCli?: TerminalKind) => void;
  closeNewTaskDialog: () => void;
  createTaskFromPrompt: (
    prompt: string,
    options?: { cli?: string; model?: string; effort?: string },
  ) => Promise<void>;
  upsertTask: (task: import("@/lib/fs/remote-agent").Task) => void;
  removeTaskById: (taskId: string) => void;
  /** Lazily create session in DB when user opens task conversation (idempotent). */
  openTaskSession: (taskId: string) => Promise<void>;
};

// ─── Seed data ────────────────────────────────────────────────────────────────

const initialBranchesByWorkspaceId: Record<string, Branch[]> = {
  "ws-sc": [
    { id: "b1", name: "master", age: "14h ago", starred: true, status: "none" },
    {
      id: "b2",
      name: "feat/meta-chat",
      age: "5h ago",
      added: 5518,
      removed: 169,
      status: "loading",
    },
    {
      id: "b3",
      name: "fix/chat-feedback-notifications",
      age: "3m ago",
      added: 178,
      removed: 13,
      status: "none",
    },
    {
      id: "b4",
      name: "fix/diff-view-text-selection",
      age: "3m ago",
      added: 86,
      removed: 18,
      status: "none",
    },
    { id: "b5", name: "fix/right-sidebar-vertical-line", age: "58m ago", status: "warn" },
    {
      id: "b6",
      name: "fix/workspace-sidebar-state",
      age: "2h ago",
      added: 109,
      removed: 23,
      status: "warn",
    },
    {
      id: "b7",
      name: "fix/git-diff-highlight-accuracy",
      age: "2h ago",
      added: 447,
      removed: 57,
      status: "active",
    },
    {
      id: "b8",
      name: "fix/tab-title-overwrite",
      age: "14m ago",
      added: 59,
      removed: 5,
      status: "warn",
    },
    {
      id: "b9",
      name: "feat/git-action-dropdown-menu",
      age: "14h ago",
      added: 1136,
      removed: 184,
      status: "none",
    },
    {
      id: "b10",
      name: "fix/shared-context-isolation",
      age: "3h ago",
      added: 90,
      removed: 20,
      status: "active",
    },
    {
      id: "b11",
      name: "fix/stear-chat-timeline",
      age: "14h ago",
      added: 899,
      removed: 129,
      status: "none",
    },
    {
      id: "b12",
      name: "feat/scrollable-tab-bar",
      age: "6d ago",
      added: 147,
      removed: 86,
      status: "none",
    },
    {
      id: "b13",
      name: "feat/shared-context-sorting-dnd",
      age: "1w ago",
      added: 2163,
      removed: 21,
      status: "none",
    },
  ],
  "ws-landing": [
    { id: "l1", name: "main", age: "4w ago", starred: true, status: "none" },
    {
      id: "l2",
      name: "feat/marketing-landing-page",
      age: "1d ago",
      added: 533,
      removed: 26,
      status: "none",
    },
  ],
};

const initialWorkspaces: Workspace[] = MOCK_ENABLED
  ? [
      {
        id: "ws-sc",
        letter: "S",
        name: "superconductor",
        color: "oklch(0.45 0.18 270)",
        gitUrl: "https://github.com/superconductor/superconductor",
        source: { kind: "mock", id: "ws-sc" },
        orgId: "personal-org",
      },
      {
        id: "ws-landing",
        letter: "L",
        name: "landing",
        color: "oklch(0.55 0.13 60)",
        gitUrl: "https://github.com/superconductor/landing",
        source: { kind: "mock", id: "ws-landing" },
        orgId: "personal-org",
      },
    ]
  : [];

// Mini mock tree for workspaces with kind="mock" — fallback until Vague 2 loads real data
const MOCK_FILE_TREE: Record<string, string[]> = {
  crates: ["sc_app/", "sc_git/", "sc_diff/"],
  docs: ["ARCHITECTURE.md", "CONTRIBUTING.md"],
  scripts: ["release.sh"],
};

const MOCK_ROOT_FILES = ["Cargo.toml", "Cargo.lock", "README.md", ".gitignore"];

// Initial in-memory tree provided to MockProvider instances
const MOCK_PROVIDER_TREE = {
  crates: { sc_app: {}, sc_git: {}, sc_diff: {} },
  docs: {
    "ARCHITECTURE.md": "# Architecture\n\nMock doc.\n",
    "CONTRIBUTING.md": "# Contributing\n\nMock doc.\n",
  },
  scripts: { "release.sh": "#!/usr/bin/env bash\nset -euo pipefail\n" },
  "Cargo.toml": '[package]\nname = "superconductor"\nversion = "0.1.0"\n',
  "Cargo.lock": "# Generated by Cargo\n",
  "README.md": "# Superconductor\n\nMock project.\n",
  ".gitignore": "/target\n",
};

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function entriesToTreeNodes(entries: FsEntry[], _parentPath: string): TreeNode[] {
  return sortEntries(entries).map((e) => ({
    path: e.path,
    name: e.name,
    type: e.type === "directory" ? "dir" : "file",
    children: e.type === "directory" ? [] : undefined,
    loaded: false,
  }));
}

function findNodeByPath(root: TreeNode, path: string): TreeNode | undefined {
  if (path === "" || path === root.path) return root;
  const parts = path.split("/").filter(Boolean);
  let current: TreeNode | undefined = root;
  for (const part of parts) {
    if (!current?.children) return undefined;
    current = current.children.find((c) => c.name === part);
  }
  return current;
}

function patchNodeChildren(root: TreeNode, path: string, children: TreeNode[]): TreeNode {
  if (path === "") {
    return { ...root, children, loaded: true };
  }
  return {
    ...root,
    children: (root.children ?? []).map((child) => {
      if (path === child.path) {
        return { ...child, children, loaded: true };
      }
      if (path.startsWith(child.path + "/")) {
        return patchNodeChildren(child, path, children);
      }
      return child;
    }),
  };
}

function getCurrentScopeKey(state: {
  activeWorkspaceId: string;
  activeBranchId: string;
}): ScopeKey {
  return scopeKey(state.activeWorkspaceId, state.activeBranchId);
}

function workspaceForScope(workspaces: Workspace[], sk: ScopeKey) {
  const [wsId] = sk.split(":") as [string, string];
  return workspaces.find((w) => w.id === wsId);
}

function flatFieldsFromEntries(entries: FsEntry[]): {
  fileTree: Record<string, string[]>;
  rootFiles: string[];
} {
  const fileTree: Record<string, string[]> = {};
  const rootFiles: string[] = [];
  for (const e of entries) {
    if (e.type === "directory") {
      fileTree[e.name] = [];
    } else {
      rootFiles.push(e.name);
    }
  }
  return { fileTree, rootFiles };
}

function makeScopeRootNode(_sk: ScopeKey): TreeNode {
  return { path: "", name: "", type: "dir", children: [], loaded: false };
}

function isMockWorkspace(workspaces: Workspace[], workspaceId: string): boolean {
  const ws = workspaces.find((w) => w.id === workspaceId);
  return ws?.source.kind === "mock";
}

const INITIAL_SCOPE = MOCK_ENABLED ? scopeKey("ws-sc", "b1") : scopeKey("", "");

let gitDebounceHandle: ReturnType<typeof setTimeout> | null = null;
function scheduleGitRefresh(
  sk: ScopeKey,
  getStore: () => { refreshGitStatus: (sk: ScopeKey) => Promise<void> },
) {
  if (gitDebounceHandle) clearTimeout(gitDebounceHandle);
  gitDebounceHandle = setTimeout(() => {
    void getStore().refreshGitStatus(sk);
  }, 300);
}

function createTerminalSet(_worktreeId: string): WorkspaceTerminal[] {
  return [];
}

function getDefaultWorktreeId(
  worktreesByWorkspaceId: Record<string, Worktree[]>,
  workspaceId: string,
  branchId: string,
): string | undefined {
  const worktrees = worktreesByWorkspaceId[workspaceId] ?? [];
  return worktrees.find((wt) => wt.branchId === branchId)?.id ?? worktrees[0]?.id;
}

const initialWorktrees: Record<string, Worktree[]> = MOCK_ENABLED
  ? {
      "ws-sc": [
        {
          id: "wt-sc-main",
          workspaceId: "ws-sc",
          branchId: "b1",
          name: "main",
          path: "/worktrees/superconductor/master",
          baseBranch: "master",
          status: "ready",
          terminals: createTerminalSet("wt-sc-main"),
        },
        {
          id: "wt-sc-meta",
          workspaceId: "ws-sc",
          branchId: "b2",
          name: "meta-chat",
          path: "/worktrees/superconductor/feat-meta-chat",
          baseBranch: "master",
          status: "syncing",
          terminals: createTerminalSet("wt-sc-meta"),
        },
        {
          id: "wt-sc-workspace-sidebar",
          workspaceId: "ws-sc",
          branchId: "b6",
          name: "workspace-sidebar-state",
          path: "/worktrees/superconductor/fix-workspace-sidebar-state",
          baseBranch: "master",
          status: "dirty",
          locked: true,
          terminals: createTerminalSet("wt-sc-workspace-sidebar"),
        },
      ],
      "ws-landing": [
        {
          id: "wt-landing-main",
          workspaceId: "ws-landing",
          branchId: "l1",
          name: "main",
          path: "/worktrees/landing/main",
          baseBranch: "main",
          status: "ready",
          terminals: createTerminalSet("wt-landing-main"),
        },
        {
          id: "wt-landing-marketing",
          workspaceId: "ws-landing",
          branchId: "l2",
          name: "marketing-landing-page",
          path: "/worktrees/landing/feat-marketing-landing-page",
          baseBranch: "main",
          status: "ready",
          terminals: createTerminalSet("wt-landing-marketing"),
        },
      ],
    }
  : {};

// Migrate old tasksByBranchId seed → tasksByWorktreeId by matching branchId on worktrees.
function buildInitialTasksByWorktreeId(): Record<string, WorkTask[]> {
  const legacy: Record<
    string,
    { id: string; title: string; status: TaskStatus; assignee: string; updatedAt: string }[]
  > = {
    b1: [
      {
        id: "task-b1-1",
        title: "Stabilize workspace bootstrap",
        status: "in_progress",
        assignee: "Codex",
        updatedAt: "12m ago",
      },
      {
        id: "task-b1-2",
        title: "Review multi-worktree session model",
        status: "todo",
        assignee: "Claude",
        updatedAt: "1h ago",
      },
    ],
    b2: [
      {
        id: "task-b2-1",
        title: "Ship meta chat timeline",
        status: "blocked",
        assignee: "Gemini",
        updatedAt: "4m ago",
      },
      {
        id: "task-b2-2",
        title: "Rebase worktree on master",
        status: "todo",
        assignee: "OpenCode",
        updatedAt: "18m ago",
      },
    ],
    b6: [
      {
        id: "task-b6-1",
        title: "Persist workspace sidebar collapse state",
        status: "in_progress",
        assignee: "Codex",
        updatedAt: "9m ago",
      },
    ],
    l2: [
      {
        id: "task-l2-1",
        title: "Refresh hero copy",
        status: "done",
        assignee: "Claude",
        updatedAt: "1d ago",
      },
      {
        id: "task-l2-2",
        title: "QA responsive navbar",
        status: "todo",
        assignee: "Codex",
        updatedAt: "39m ago",
      },
    ],
  };

  const result: Record<string, WorkTask[]> = {};

  for (const [wsId, wts] of Object.entries(initialWorktrees)) {
    for (const wt of wts) {
      const tasks = legacy[wt.branchId];
      if (tasks) {
        result[wt.id] = tasks.map(({ id, title, status, assignee, updatedAt }) => ({
          id,
          title,
          status,
          assignee,
          updatedAt,
        }));
      } else {
        result[wt.id] = [];
      }
      void wsId; // suppress unused-var lint
    }
  }

  return result;
}

/**
 * Resolve the conversation root task by walking up the parentSessionId chain.
 * Returns the root task's id (which has parentSessionId = null).
 */
function resolveConversationRoot(
  task: import("@/lib/fs/remote-agent").Task,
  allTasks: import("@/lib/fs/remote-agent").Task[],
): string {
  let cur = task;
  const seen = new Set<string>();
  while (cur.parentSessionId) {
    if (seen.has(cur.id)) break; // cycle detection
    seen.add(cur.id);
    const parent = allTasks.find((t) => t.sessionId === cur.parentSessionId);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

const TITLE_BY_KIND: Record<TerminalKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  gemini: "Gemini",
};

/**
 * Mirror a single Task into the existing WorkspaceTerminal[] list, parent-aware.
 * - Root task (no parentSessionId) → create or update its own tab.
 * - Child task (parentSessionId set) → update the conversation root's tab in place,
 *   keeping the tab id stable (= root.sessionId) but pointing taskId at the latest child.
 */
function buildSessionTabFor(
  task: import("@/lib/fs/remote-agent").Task,
  allTasks: import("@/lib/fs/remote-agent").Task[],
  existing: WorkspaceTerminal[],
): WorkspaceTerminal[] {
  const conversationRootTaskId = resolveConversationRoot(task, allTasks);
  const tabStatus: WorkspaceTerminal["status"] = task.status === "running" ? "busy" : "ready";
  const cliKind = (task.cli as TerminalKind) ?? "codex";
  const titleFor = task.title?.slice(0, 40) || TITLE_BY_KIND[cliKind];
  // Generate deterministic sessionId if not yet persisted (lazy session creation)
  const sessionId = task.sessionId || `${task.id}-session`;

  if (task.id === conversationRootTaskId) {
    // ROOT task — create or update tab keyed on sessionId (deterministic or from DB).
    const tab: WorkspaceTerminal = {
      id: sessionId,
      kind: cliKind,
      title: titleFor,
      status: tabStatus,
      workspaceId: task.workspaceId,
      lastCommand: TITLE_BY_KIND[cliKind],
      taskId: task.id,
    };
    const idx = existing.findIndex((t) => t.id === sessionId);
    return idx >= 0 ? existing.map((t, i) => (i === idx ? tab : t)) : [...existing, tab];
  }

  // CHILD task — find the existing tab for the conversation root and
  // update its taskId to point to the latest task in the chain.
  const rootTab = existing.find((t) => t.taskId === conversationRootTaskId);
  if (!rootTab) return existing; // shouldn't happen, fail closed
  return existing.map((t) =>
    t.id === rootTab.id ? { ...t, taskId: task.id, status: tabStatus, title: titleFor } : t,
  );
}

export const useIDE = create<State>()(
  persist<State>(
    (set, get) => ({
      workspaces: initialWorkspaces,
      activeWorkspaceId: MOCK_ENABLED ? "ws-sc" : "",
      activeBranchId: MOCK_ENABLED ? "b1" : "",
      currentOrgId: MOCK_ENABLED ? "personal-org" : null,

      branchesByWorkspaceId: MOCK_ENABLED ? initialBranchesByWorkspaceId : {},
      activeBranchIdByWorkspaceId: (MOCK_ENABLED
        ? { "ws-sc": "b1", "ws-landing": "l1" }
        : {}) as Record<string, string>,

      messagesBySessionId: {},
      openFilesByScope: {},
      activeTabByScope: INITIAL_SCOPE ? { [INITIAL_SCOPE]: "overview" } : {},
      expandedFoldersByScope: INITIAL_SCOPE ? { [INITIAL_SCOPE]: { crates: true } } : {},
      activeWorktreeIdByScope: INITIAL_SCOPE ? { [INITIAL_SCOPE]: "wt-sc-main" } : {},
      tasksByWorktreeId: buildInitialTasksByWorktreeId(),
      tasksByWorkspaceId: {},
      activeTaskId: null,
      taskDetailDialogTaskId: null,
      newTaskDialogOpen: false,
      taskEventsByTaskId: {},
      dismissedTaskIds: [],
      worktreesByWorkspaceId: initialWorktrees,
      sessionsByWorkspaceId: {},
      activeSessionIdByWorkspaceId: {},
      pinnedSessionIdsByWorkspaceId: {},
      sessionClearTickByWorkspace: {},
      agentProvidersByWorkspaceId: {},

      theme: readStoredTheme(),
      showFiles: true,
      showSidebar: true,
      showTerminal: false,
      showAgentPanel: false,
      applyingFromUrl: false,
      activeAgent: "claude",
      previewMode: false,
      filesTab: "files",
      settingsSidebarCollapsed: false,
      thinking: true,
      webSearch: false,
      codexApiKey:
        typeof window !== "undefined"
          ? (window.localStorage.getItem("codex-api-key") ?? undefined)
          : undefined,
      claudeApiKey:
        typeof window !== "undefined"
          ? (window.localStorage.getItem("claude-api-key") ?? undefined)
          : undefined,
      codexModel:
        typeof window !== "undefined"
          ? (window.localStorage.getItem("codex-model") ?? undefined)
          : undefined,
      selectedModelByCli:
        typeof window !== "undefined"
          ? (() => {
              try {
                const raw = window.localStorage.getItem("selected-model-by-cli");
                return raw ? (JSON.parse(raw) as Record<string, string>) : {};
              } catch {
                return {};
              }
            })()
          : {},
      approvalModeByCli:
        typeof window !== "undefined"
          ? (() => {
              try {
                const raw = window.localStorage.getItem("approval-mode-by-cli");
                return raw
                  ? (JSON.parse(raw) as Record<string, "auto" | "confirm" | "sandbox">)
                  : {};
              } catch {
                return {};
              }
            })()
          : {},
      claudeContextOverride:
        typeof window !== "undefined"
          ? (() => {
              const raw = window.localStorage.getItem("claude-context-override");
              return raw === "200k" || raw === "1m" ? raw : undefined;
            })()
          : undefined,
      lastUsageByCli: {},
      codexAuth:
        typeof window !== "undefined"
          ? (() => {
              try {
                const raw = window.localStorage.getItem("codex-auth");
                return raw ? (JSON.parse(raw) as State["codexAuth"]) : undefined;
              } catch {
                return undefined;
              }
            })()
          : undefined,

      branchesLoading: true,
      worktreesLoading: true,
      tasksLoading: true,
      fileTreeLoading: true,
      sessionsLoading: true,
      _hydrated: false,
      hydrate: () => {
        set({
          branchesLoading: false,
          worktreesLoading: false,
          tasksLoading: false,
          fileTreeLoading: false,
        });
      },

      // Legacy flat fields — kept for retrocompat with FilesPanel (consumers exist, do not remove).
      fileTree: MOCK_ENABLED ? MOCK_FILE_TREE : {},
      rootFiles: MOCK_ENABLED ? MOCK_ROOT_FILES : [],

      // Scoped tree structure — Vague 2 le peuplera via loadRoot
      treeByScope: INITIAL_SCOPE ? { [INITIAL_SCOPE]: makeScopeRootNode(INITIAL_SCOPE) } : {},
      loadingPaths: {},

      gitStatusByScope: {},

      refreshGitStatus: async (sk) => {
        const state = get();
        const ws = workspaceForScope(state.workspaces, sk);
        if (!ws) return;

        try {
          const provider = await providerFor(
            ws.source,
            ws.name,
            ws.source.kind === "mock" ? MOCK_PROVIDER_TREE : undefined,
          );

          const status = await computeStatus(provider);
          set((s) => ({
            gitStatusByScope: { ...s.gitStatusByScope, [sk]: status },
          }));
        } catch {
          // Silencieux — ne pas spammer l'utilisateur
        }
      },

      loadRoot: async (sk) => {
        const state = get();
        const ws = workspaceForScope(state.workspaces, sk);
        if (!ws) return;

        set((s) => ({
          fileTreeLoading: sk === getCurrentScopeKey(s),
          loadingPaths: {
            ...s.loadingPaths,
            [sk]: { ...s.loadingPaths[sk], "": true },
          },
        }));

        try {
          const provider = await providerFor(
            ws.source,
            ws.name,
            ws.source.kind === "mock" ? MOCK_PROVIDER_TREE : undefined,
          );

          const raw = await provider.list("");
          const entries = sortEntries(raw);
          const children = entriesToTreeNodes(entries, "");
          const { fileTree, rootFiles } = flatFieldsFromEntries(entries);

          set((s) => {
            const isActive = sk === getCurrentScopeKey(s);
            const root = s.treeByScope[sk] ?? makeScopeRootNode(sk);
            return {
              treeByScope: {
                ...s.treeByScope,
                [sk]: { ...root, children, loaded: true },
              },
              loadingPaths: {
                ...s.loadingPaths,
                [sk]: { ...s.loadingPaths[sk], "": false },
              },
              fileTreeLoading: isActive ? false : s.fileTreeLoading,
              fileTree: isActive ? fileTree : s.fileTree,
              rootFiles: isActive ? rootFiles : s.rootFiles,
            };
          });
          void get().refreshGitStatus(sk);
        } catch (e) {
          set((s) => ({
            fileTreeLoading: false,
            loadingPaths: {
              ...s.loadingPaths,
              [sk]: { ...s.loadingPaths[sk], "": false },
            },
          }));
          if (e instanceof FsError) {
            toast.error(e.message);
          } else {
            console.error("[loadRoot]", e);
          }
        }
      },

      loadChildren: async (sk, path) => {
        const state = get();
        const existingRoot = state.treeByScope[sk];
        const node = existingRoot ? findNodeByPath(existingRoot, path) : undefined;
        if (node?.loaded) return;

        const ws = workspaceForScope(state.workspaces, sk);
        if (!ws) return;

        set((s) => ({
          loadingPaths: {
            ...s.loadingPaths,
            [sk]: { ...s.loadingPaths[sk], [path]: true },
          },
        }));

        try {
          const provider = await providerFor(
            ws.source,
            ws.name,
            ws.source.kind === "mock" ? MOCK_PROVIDER_TREE : undefined,
          );

          const raw = await provider.list(path);
          const entries = sortEntries(raw);
          const children = entriesToTreeNodes(entries, path);

          set((s) => {
            const isActive = sk === getCurrentScopeKey(s);
            const root = s.treeByScope[sk] ?? makeScopeRootNode(sk);
            const patchedRoot = patchNodeChildren(root, path, children);

            const dirs = entries.filter((e) => e.type === "directory").map((e) => e.name + "/");
            const files = entries.filter((e) => e.type === "file").map((e) => e.name);
            const updatedFileTree = isActive
              ? { ...s.fileTree, [path]: [...dirs, ...files] }
              : s.fileTree;

            return {
              treeByScope: { ...s.treeByScope, [sk]: patchedRoot },
              loadingPaths: {
                ...s.loadingPaths,
                [sk]: { ...s.loadingPaths[sk], [path]: false },
              },
              fileTree: updatedFileTree,
            };
          });
        } catch (e) {
          set((s) => ({
            loadingPaths: {
              ...s.loadingPaths,
              [sk]: { ...s.loadingPaths[sk], [path]: false },
            },
          }));
          if (e instanceof FsError) {
            toast.error(e.message);
          } else {
            console.error("[loadChildren]", e);
          }
        }
      },

      createEntry: async (sk, parentPath, name, type) => {
        const ws = workspaceForScope(get().workspaces, sk);
        if (!ws) return;

        const fullPath = parentPath ? `${parentPath}/${name}` : name;

        try {
          const provider = await providerFor(
            ws.source,
            ws.name,
            ws.source.kind === "mock" ? MOCK_PROVIDER_TREE : undefined,
          );

          if (type === "dir") {
            await provider.mkdir(fullPath);
          } else {
            await provider.writeFile(fullPath, "");
          }

          if (parentPath === "") {
            await get().loadRoot(sk);
          } else {
            await get().loadChildren(sk, parentPath);
          }
          scheduleGitRefresh(sk, get);
        } catch (e) {
          if (e instanceof FsError) {
            toast.error(e.message);
          } else {
            console.error("[createEntry]", e);
            toast.error("Impossible de créer l'entrée.");
          }
        }
      },

      removeEntry: async (sk, path) => {
        const ws = workspaceForScope(get().workspaces, sk);
        if (!ws) return;

        const parts = path.split("/").filter(Boolean);
        const parentPath = parts.slice(0, -1).join("/");

        try {
          const provider = await providerFor(
            ws.source,
            ws.name,
            ws.source.kind === "mock" ? MOCK_PROVIDER_TREE : undefined,
          );

          await provider.remove(path);

          if (parentPath === "") {
            await get().loadRoot(sk);
          } else {
            await get().loadChildren(sk, parentPath);
          }
          scheduleGitRefresh(sk, get);
        } catch (e) {
          if (e instanceof FsError) {
            toast.error(e.message);
          } else {
            console.error("[removeEntry]", e);
            toast.error("Impossible de supprimer l'entrée.");
          }
        }
      },

      getWorkspaceIdForBranch: (branchId) => {
        const s = get();
        for (const [wsId, branches] of Object.entries(s.branchesByWorkspaceId)) {
          if (branches.some((b) => b.id === branchId)) return wsId;
        }
        return undefined;
      },

      hydrateSessionsFromDb: async () => {
        const MAX_ATTEMPTS = 10;
        const RETRY_MS = 2000;

        try {
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const { workspaces } = get();
            const remoteWorkspaces = workspaces.filter((w) => w.source.kind === "remote-agent");
            if (remoteWorkspaces.length === 0) return;

            let anySuccess = false;
            for (const ws of remoteWorkspaces) {
              if (ws.source.kind !== "remote-agent") continue;
              try {
                const provider = new RemoteAgentProvider(
                  ws.source.label,
                  ws.source.url,
                  ws.source.token,
                );
                await provider.connect();
                const sessions = await persistence.sessions.list(provider, ws.id);
                if (sessions.length === 0) {
                  anySuccess = true;
                  continue;
                }
                const workspaceTerminals = sessions.map((s) => ({
                  id: s.id,
                  kind: (s.cli as import("@/store/ide").TerminalKind) ?? "codex",
                  title: s.title ?? s.cli,
                  status: (s.status === "busy" ? "busy" : "idle") as "ready" | "busy" | "idle",
                  workspaceId: ws.id,
                  lastCommand: s.cli,
                }));
                set((cur) => ({
                  sessionsByWorkspaceId: {
                    ...cur.sessionsByWorkspaceId,
                    [ws.id]: workspaceTerminals,
                  },
                }));
                anySuccess = true;
              } catch (e) {
                if (attempt === MAX_ATTEMPTS) {
                  console.warn(
                    `[store] hydrateSessionsFromDb: failed for workspace ${ws.id} after ${MAX_ATTEMPTS} attempts`,
                    e,
                  );
                } else {
                  console.log(
                    `[store] hydrateSessionsFromDb: attempt ${attempt}/${MAX_ATTEMPTS} failed for ${ws.id}, retrying in ${RETRY_MS}ms`,
                  );
                }
              }
            }

            if (anySuccess) return;
            if (attempt < MAX_ATTEMPTS) {
              await new Promise<void>((resolve) => setTimeout(resolve, RETRY_MS));
            }
          }
        } finally {
          set({ sessionsLoading: false });
        }
      },

      setActiveWorkspace: (id) => {
        set((s) => {
          const branches = s.branchesByWorkspaceId[id] ?? [];
          const remembered = s.activeBranchIdByWorkspaceId[id];
          const nextBranchId =
            remembered && branches.some((b) => b.id === remembered)
              ? remembered
              : (branches[0]?.id ?? s.activeBranchId);
          const key = scopeKey(id, nextBranchId);
          const nextWorktreeId =
            s.activeWorktreeIdByScope[key] ??
            getDefaultWorktreeId(s.worktreesByWorkspaceId, id, nextBranchId);
          const isMock = s.workspaces.find((w) => w.id === id)?.source.kind === "mock";
          return {
            activeWorkspaceId: id,
            activeBranchId: nextBranchId,
            activeBranchIdByWorkspaceId: { ...s.activeBranchIdByWorkspaceId, [id]: nextBranchId },
            activeWorktreeIdByScope: nextWorktreeId
              ? { ...s.activeWorktreeIdByScope, [key]: nextWorktreeId }
              : s.activeWorktreeIdByScope,
            fileTree: isMock ? MOCK_FILE_TREE : {},
            rootFiles: isMock ? MOCK_ROOT_FILES : [],
            fileTreeLoading: !isMock,
            treeByScope: s.treeByScope[key]
              ? s.treeByScope
              : { ...s.treeByScope, [key]: makeScopeRootNode(key) },
          };
        });
        void get().loadRoot(scopeKey(id, get().activeBranchId));
      },

      setActiveBranch: (id) => {
        set((s) => {
          let wsId = s.activeWorkspaceId;
          for (const [wId, branches] of Object.entries(s.branchesByWorkspaceId)) {
            if (branches.some((b) => b.id === id)) {
              wsId = wId;
              break;
            }
          }
          const key = scopeKey(wsId, id);
          const nextWorktreeId =
            s.activeWorktreeIdByScope[key] ??
            getDefaultWorktreeId(s.worktreesByWorkspaceId, wsId, id);
          const isMock = isMockWorkspace(s.workspaces, wsId);
          return {
            activeBranchId: id,
            activeWorkspaceId: wsId,
            activeBranchIdByWorkspaceId: { ...s.activeBranchIdByWorkspaceId, [wsId]: id },
            activeWorktreeIdByScope: nextWorktreeId
              ? { ...s.activeWorktreeIdByScope, [key]: nextWorktreeId }
              : s.activeWorktreeIdByScope,
            fileTree: isMock ? MOCK_FILE_TREE : {},
            rootFiles: isMock ? MOCK_ROOT_FILES : [],
            fileTreeLoading: !isMock,
            treeByScope: s.treeByScope[key]
              ? s.treeByScope
              : { ...s.treeByScope, [key]: makeScopeRootNode(key) },
          };
        });
        const newSk = scopeKey(get().activeWorkspaceId, id);
        void get().loadRoot(newSk);
        void get().refreshGitStatus(newSk);
      },

      setActiveTab: (id) =>
        set((s) => {
          const key = scopeKey(s.activeWorkspaceId, s.activeBranchId);
          return { activeTabByScope: { ...s.activeTabByScope, [key]: id } };
        }),

      setActiveWorktree: (id) =>
        set((s) => {
          const key = scopeKey(s.activeWorkspaceId, s.activeBranchId);
          return {
            activeWorktreeIdByScope: { ...s.activeWorktreeIdByScope, [key]: id },
          };
        }),

      toggleFolder: (name) => {
        const sk = scopeKey(get().activeWorkspaceId, get().activeBranchId);
        const current = get().expandedFoldersByScope[sk] ?? {};
        const wasOpen = !!current[name];
        set((s) => ({
          expandedFoldersByScope: {
            ...s.expandedFoldersByScope,
            [sk]: { ...current, [name]: !wasOpen },
          },
        }));
        if (!wasOpen) {
          const children = get().fileTree[name];
          if (!children || children.length === 0) {
            void get().loadChildren(sk, name);
          }
        }
      },

      toggleFiles: () => set((s) => ({ showFiles: !s.showFiles })),
      toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),
      toggleSettingsSidebar: () =>
        set((s) => ({ settingsSidebarCollapsed: !s.settingsSidebarCollapsed })),
      toggleTerminal: () => set((s) => ({ showTerminal: !s.showTerminal })),
      toggleAgentPanel: () => set((s) => ({ showAgentPanel: !s.showAgentPanel })),
      setApplyingFromUrl: (v) => set({ applyingFromUrl: v }),
      setActiveAgent: (k) => set({ activeAgent: k }),
      togglePreview: () => set((s) => ({ previewMode: !s.previewMode })),
      setTheme: (theme) => {
        writeStoredTheme(theme);
        set({ theme });
      },
      setFilesTab: (t) => set({ filesTab: t }),
      toggleThinking: () => set((s) => ({ thinking: !s.thinking })),
      toggleWebSearch: () => set((s) => ({ webSearch: !s.webSearch })),
      setCodexApiKey: (key) => {
        if (typeof window !== "undefined") {
          if (key) window.localStorage.setItem("codex-api-key", key);
          else window.localStorage.removeItem("codex-api-key");
        }
        set({ codexApiKey: key || undefined });
      },
      setClaudeApiKey: (key) => {
        if (typeof window !== "undefined") {
          if (key) window.localStorage.setItem("claude-api-key", key);
          else window.localStorage.removeItem("claude-api-key");
        }
        set({ claudeApiKey: key || undefined });
      },
      setCodexModel: (model) => {
        if (typeof window !== "undefined") {
          if (model) window.localStorage.setItem("codex-model", model);
          else window.localStorage.removeItem("codex-model");
        }
        set({ codexModel: model || undefined });
      },
      setModelForCli: (cli, model) => {
        const next = { ...get().selectedModelByCli, [cli]: model };
        if (typeof window !== "undefined")
          window.localStorage.setItem("selected-model-by-cli", JSON.stringify(next));
        set({ selectedModelByCli: next });
      },
      setApprovalMode: (cli, mode) => {
        const next = { ...get().approvalModeByCli, [cli]: mode };
        if (typeof window !== "undefined")
          window.localStorage.setItem("approval-mode-by-cli", JSON.stringify(next));
        set({ approvalModeByCli: next });
      },
      setClaudeContextOverride: (override) => {
        if (typeof window !== "undefined") {
          if (override) window.localStorage.setItem("claude-context-override", override);
          else window.localStorage.removeItem("claude-context-override");
        }
        set({ claudeContextOverride: override });
      },
      setLastUsage: (cli, inputTokens, outputTokens) => {
        set((s) => ({
          lastUsageByCli: {
            ...s.lastUsageByCli,
            [cli]: { inputTokens, outputTokens, ts: Date.now() },
          },
        }));
      },
      setCodexAuth: (auth) => {
        if (typeof window !== "undefined") {
          if (auth) window.localStorage.setItem("codex-auth", JSON.stringify(auth));
          else window.localStorage.removeItem("codex-auth");
        }
        set({ codexAuth: auth ?? undefined });
      },
      refreshCodexTokens: async () => {
        const current = get().codexAuth;
        if (!current) return false;
        try {
          const { refreshTokens, parseIdTokenClaims } = await import("@/lib/codex-auth");
          const next = await refreshTokens({ data: { refreshToken: current.refreshToken } });
          const claims = parseIdTokenClaims(next.idToken);
          get().setCodexAuth({
            idToken: next.idToken,
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
            lastRefresh: new Date().toISOString(),
            email: claims.email ?? current.email,
            chatgptPlanType: claims.chatgptPlanType ?? current.chatgptPlanType,
            chatgptAccountId: claims.chatgptAccountId ?? current.chatgptAccountId,
          });
          return true;
        } catch (e) {
          console.error("[refreshCodexTokens]", e);
          return false;
        }
      },

      sendMessage: (content) =>
        set((s) => {
          const activeSessionId = s.activeSessionIdByWorkspaceId[s.activeWorkspaceId];
          if (!activeSessionId) return s;
          const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content,
          };
          const assistantMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            model: "Anthropic · Opus 4.6 (1M)",
            content: generateAssistantReply(content),
          };
          const prev = s.messagesBySessionId[activeSessionId] ?? [];
          return {
            messagesBySessionId: {
              ...s.messagesBySessionId,
              [activeSessionId]: [...prev, userMsg, assistantMsg],
            },
          };
        }),

      addBranch: (workspaceId, name) =>
        set((s) => {
          const branchId = crypto.randomUUID();
          const worktreeId = crypto.randomUUID();
          const key = scopeKey(workspaceId, branchId);
          const newBranch: Branch = { id: branchId, name, age: "just now", status: "none" };
          return {
            branchesByWorkspaceId: {
              ...s.branchesByWorkspaceId,
              [workspaceId]: [...(s.branchesByWorkspaceId[workspaceId] ?? []), newBranch],
            },
            tasksByWorktreeId: { ...s.tasksByWorktreeId, [worktreeId]: [] },
            worktreesByWorkspaceId: {
              ...s.worktreesByWorkspaceId,
              [workspaceId]: [
                ...(s.worktreesByWorkspaceId[workspaceId] ?? []),
                {
                  id: worktreeId,
                  workspaceId,
                  branchId,
                  name: name.split("/").pop() ?? name,
                  path: `/worktrees/${workspaceId}/${name.replaceAll("/", "-")}`,
                  baseBranch: "main",
                  status: "ready",
                  terminals: createTerminalSet(worktreeId),
                },
              ],
            },
            activeWorktreeIdByScope: {
              ...s.activeWorktreeIdByScope,
              [key]: worktreeId,
            },
          };
        }),

      toggleStar: (branchId) =>
        set((s) => {
          const next: Record<string, Branch[]> = {};
          for (const [wsId, branches] of Object.entries(s.branchesByWorkspaceId)) {
            next[wsId] = branches.map((b) =>
              b.id === branchId ? { ...b, starred: !b.starred } : b,
            );
          }
          return { branchesByWorkspaceId: next };
        }),

      addWorkspace: (name, source, opts) => {
        const id = crypto.randomUUID();
        const branchId = crypto.randomUUID();
        const worktreeId = crypto.randomUUID();
        const effectiveSource: WorkspaceSource = source ?? { kind: "mock", id };
        const color =
          effectiveSource.kind === "local-web"
            ? "oklch(0.55 0.15 140)"
            : effectiveSource.kind === "remote-agent"
              ? "oklch(0.55 0.15 30)"
              : "oklch(0.50 0.15 200)";
        const workspace: Workspace = {
          id,
          letter: name.charAt(0).toUpperCase() || "W",
          name,
          color,
          source: effectiveSource,
          orgId: get().currentOrgId ?? "personal-org",
          ...(opts?.rootPath ? { rootPath: opts.rootPath } : {}),
          ...(opts?.gitUrl ? { gitUrl: opts.gitUrl } : {}),
        };
        set((s) => ({
          workspaces: [...s.workspaces, workspace],
          branchesByWorkspaceId: {
            ...s.branchesByWorkspaceId,
            [id]: [{ id: branchId, name: "main", age: "just now", starred: true, status: "none" }],
          },
          activeBranchIdByWorkspaceId: { ...s.activeBranchIdByWorkspaceId, [id]: branchId },
          tasksByWorktreeId: { ...s.tasksByWorktreeId, [worktreeId]: [] },
          worktreesByWorkspaceId: {
            ...s.worktreesByWorkspaceId,
            [id]: [
              {
                id: worktreeId,
                workspaceId: id,
                branchId,
                name: "main",
                path: `/worktrees/${id}/main`,
                baseBranch: "main",
                status: "ready",
                terminals: createTerminalSet(worktreeId),
              },
            ],
          },
          activeWorktreeIdByScope: {
            ...s.activeWorktreeIdByScope,
            [scopeKey(id, branchId)]: worktreeId,
          },
        }));
        storage.putWorkspace(workspace.orgId, workspace).catch(console.warn);
        return id;
      },

      addTask: (worktreeId, title, description) =>
        set((s) => ({
          tasksByWorktreeId: {
            ...s.tasksByWorktreeId,
            [worktreeId]: [
              ...(s.tasksByWorktreeId[worktreeId] ?? []),
              {
                id: crypto.randomUUID(),
                title,
                description: description?.trim() ? description.trim() : undefined,
                status: "todo",
                assignee: "Codex",
                updatedAt: "just now",
              },
            ],
          },
        })),

      updateTask: (worktreeId, taskId, patch) =>
        set((s) => ({
          tasksByWorktreeId: {
            ...s.tasksByWorktreeId,
            [worktreeId]: (s.tasksByWorktreeId[worktreeId] ?? []).map((task) => {
              if (task.id !== taskId) return task;
              const nextTitle = patch.title !== undefined ? patch.title.trim() : task.title;
              const nextDescription =
                patch.description !== undefined
                  ? patch.description.trim() || undefined
                  : task.description;
              return {
                ...task,
                title: nextTitle || task.title,
                description: nextDescription,
                updatedAt: "just now",
              };
            }),
          },
        })),

      removeTask: (worktreeId, taskId) =>
        set((s) => ({
          tasksByWorktreeId: {
            ...s.tasksByWorktreeId,
            [worktreeId]: (s.tasksByWorktreeId[worktreeId] ?? []).filter(
              (task) => task.id !== taskId,
            ),
          },
        })),

      cycleTaskStatus: (worktreeId, taskId) =>
        set((s) => {
          const nextStatus: Record<TaskStatus, TaskStatus> = {
            todo: "in_progress",
            in_progress: "blocked",
            blocked: "done",
            done: "todo",
          };
          return {
            tasksByWorktreeId: {
              ...s.tasksByWorktreeId,
              [worktreeId]: (s.tasksByWorktreeId[worktreeId] ?? []).map((task) =>
                task.id === taskId
                  ? { ...task, status: nextStatus[task.status], updatedAt: "just now" }
                  : task,
              ),
            },
          };
        }),

      setTaskStatus: (worktreeId, taskId, status) =>
        set((s) => ({
          tasksByWorktreeId: {
            ...s.tasksByWorktreeId,
            [worktreeId]: (s.tasksByWorktreeId[worktreeId] ?? []).map((task) =>
              task.id === taskId ? { ...task, status, updatedAt: "just now" } : task,
            ),
          },
        })),

      addWorktree: (workspaceId, branchId, name) =>
        set((s) => {
          const worktreeId = crypto.randomUUID();
          const branchName =
            (s.branchesByWorkspaceId[workspaceId] ?? []).find((b) => b.id === branchId)?.name ??
            "branch";
          const displayName = name?.trim() || branchName.split("/").pop() || branchName;
          const key = scopeKey(workspaceId, branchId);
          return {
            worktreesByWorkspaceId: {
              ...s.worktreesByWorkspaceId,
              [workspaceId]: [
                ...(s.worktreesByWorkspaceId[workspaceId] ?? []),
                {
                  id: worktreeId,
                  workspaceId,
                  branchId,
                  name: displayName,
                  path: `/worktrees/${workspaceId}/${displayName.replaceAll("/", "-")}`,
                  baseBranch: "main",
                  status: "ready",
                  terminals: createTerminalSet(worktreeId),
                },
              ],
            },
            tasksByWorktreeId: { ...s.tasksByWorktreeId, [worktreeId]: [] },
            activeWorktreeIdByScope: {
              ...s.activeWorktreeIdByScope,
              [key]: worktreeId,
            },
            activeTabByScope: {
              ...s.activeTabByScope,
              [key]: `terminal:${worktreeId}-codex`,
            },
          };
        }),

      addTerminal: (worktreeId, kind) => {
        const id = `${worktreeId}-${kind}-${crypto.randomUUID().slice(0, 8)}`;
        const titleByKind: Record<TerminalKind, string> = {
          codex: "Codex",
          claude: "Claude Code",
          opencode: "OpenCode",
          gemini: "Gemini",
        };
        const commandByKind: Record<TerminalKind, string> = {
          codex: "codex run",
          claude: "claude",
          opencode: "opencode run",
          gemini: "gemini",
        };
        set((s) => {
          const updated: Record<string, Worktree[]> = { ...s.worktreesByWorkspaceId };
          for (const [wsId, wts] of Object.entries(s.worktreesByWorkspaceId)) {
            if (wts.some((w) => w.id === worktreeId)) {
              updated[wsId] = wts.map((w) =>
                w.id === worktreeId
                  ? {
                      ...w,
                      terminals: [
                        ...w.terminals,
                        {
                          id,
                          kind,
                          title: titleByKind[kind],
                          status: "ready",
                          workspaceId: wsId,
                          worktreeId,
                          lastCommand: commandByKind[kind],
                        },
                      ],
                    }
                  : w,
              );
            }
          }
          return { worktreesByWorkspaceId: updated };
        });
        return id;
      },

      pinSessionToWorktree: (sessionId, worktreeId) =>
        set((s) => {
          const next: Record<string, WorkspaceTerminal[]> = {};
          for (const [wsId, sessions] of Object.entries(s.sessionsByWorkspaceId)) {
            next[wsId] = sessions.map((sess) =>
              sess.id === sessionId ? { ...sess, worktreeId: worktreeId ?? undefined } : sess,
            );
          }
          return { sessionsByWorkspaceId: next };
        }),

      tickClearSession: (workspaceId) =>
        set((s) => ({
          sessionClearTickByWorkspace: {
            ...s.sessionClearTickByWorkspace,
            [workspaceId]: (s.sessionClearTickByWorkspace[workspaceId] ?? 0) + 1,
          },
        })),

      setActiveSession: (sessionId) =>
        set((s) => ({
          activeSessionIdByWorkspaceId: {
            ...s.activeSessionIdByWorkspaceId,
            [s.activeWorkspaceId]: sessionId,
          },
        })),

      addAgentSession: (kind) => {
        const titleByKind: Record<TerminalKind, string> = {
          codex: "Codex",
          claude: "Claude Code",
          opencode: "OpenCode",
          gemini: "Gemini",
        };
        const commandByKind: Record<TerminalKind, string> = {
          codex: "codex run",
          claude: "claude",
          opencode: "opencode run",
          gemini: "gemini",
        };
        set((s) => {
          const workspaceId = s.activeWorkspaceId;
          const id = `${workspaceId}-${kind}-${crypto.randomUUID().slice(0, 8)}`;
          const session: WorkspaceTerminal = {
            id,
            kind,
            title: titleByKind[kind],
            status: "ready",
            workspaceId,
            lastCommand: commandByKind[kind],
          };
          const current = s.sessionsByWorkspaceId[workspaceId] ?? [];
          return {
            sessionsByWorkspaceId: {
              ...s.sessionsByWorkspaceId,
              [workspaceId]: [...current, session],
            },
            activeSessionIdByWorkspaceId: {
              ...s.activeSessionIdByWorkspaceId,
              [workspaceId]: id,
            },
          };
        });
      },

      closeAgentSession: (sessionId) =>
        set((s) => {
          const nextSessions: Record<string, WorkspaceTerminal[]> = {};
          for (const [wsId, list] of Object.entries(s.sessionsByWorkspaceId)) {
            nextSessions[wsId] = list.filter((t) => t.id !== sessionId);
          }
          const nextActive: Record<string, string> = { ...s.activeSessionIdByWorkspaceId };
          for (const [wsId, id] of Object.entries(nextActive)) {
            if (id === sessionId) {
              const remaining = nextSessions[wsId] ?? [];
              if (remaining.length > 0) nextActive[wsId] = remaining[remaining.length - 1].id;
              else delete nextActive[wsId];
            }
          }
          // Drop messages for the closed session.
          const { [sessionId]: _dropped, ...restMessages } = s.messagesBySessionId;
          // Remove from pinned lists.
          const nextPinned: Record<string, string[]> = {};
          for (const [wsId, pins] of Object.entries(s.pinnedSessionIdsByWorkspaceId)) {
            nextPinned[wsId] = pins.filter((id) => id !== sessionId);
          }
          return {
            sessionsByWorkspaceId: nextSessions,
            activeSessionIdByWorkspaceId: nextActive,
            messagesBySessionId: restMessages,
            pinnedSessionIdsByWorkspaceId: nextPinned,
          };
        }),

      pinSession: (sessionId) =>
        set((s) => {
          const workspaceId = s.activeWorkspaceId;
          const activeId = s.activeSessionIdByWorkspaceId[workspaceId];
          if (sessionId === activeId) return {};
          const current = s.pinnedSessionIdsByWorkspaceId[workspaceId] ?? [];
          if (current.includes(sessionId)) return {};
          if (current.length >= 3) return {};
          return {
            pinnedSessionIdsByWorkspaceId: {
              ...s.pinnedSessionIdsByWorkspaceId,
              [workspaceId]: [...current, sessionId],
            },
          };
        }),

      unpinSession: (sessionId) =>
        set((s) => {
          const workspaceId = s.activeWorkspaceId;
          const current = s.pinnedSessionIdsByWorkspaceId[workspaceId] ?? [];
          return {
            pinnedSessionIdsByWorkspaceId: {
              ...s.pinnedSessionIdsByWorkspaceId,
              [workspaceId]: current.filter((id) => id !== sessionId),
            },
          };
        }),

      removeWorktree: (worktreeId) =>
        set((s) => {
          // Drop tasks for this worktree.
          const { [worktreeId]: _tasks, ...restTasks } = s.tasksByWorktreeId;
          // Clear pin on any session pointing to this worktree.
          const nextSessions: Record<string, WorkspaceTerminal[]> = {};
          for (const [wsId, sessions] of Object.entries(s.sessionsByWorkspaceId)) {
            nextSessions[wsId] = sessions.map((sess) =>
              sess.worktreeId === worktreeId ? { ...sess, worktreeId: undefined } : sess,
            );
          }
          // Remove the worktree from its workspace list.
          const nextWorktrees: Record<string, Worktree[]> = {};
          for (const [wsId, wts] of Object.entries(s.worktreesByWorkspaceId)) {
            nextWorktrees[wsId] = wts.filter((wt) => wt.id !== worktreeId);
          }
          return {
            tasksByWorktreeId: restTasks,
            sessionsByWorkspaceId: nextSessions,
            worktreesByWorkspaceId: nextWorktrees,
          };
        }),

      removeBranch: (workspaceId, branchId) => {
        const s = get();
        // Cascade: remove all worktrees for this branch.
        const worktreesToRemove = (s.worktreesByWorkspaceId[workspaceId] ?? [])
          .filter((wt) => wt.branchId === branchId)
          .map((wt) => wt.id);
        for (const wtId of worktreesToRemove) {
          get().removeWorktree(wtId);
        }
        set((cur) => ({
          branchesByWorkspaceId: {
            ...cur.branchesByWorkspaceId,
            [workspaceId]: (cur.branchesByWorkspaceId[workspaceId] ?? []).filter(
              (b) => b.id !== branchId,
            ),
          },
        }));
      },

      removeWorkspace: (workspaceId) => {
        const s = get();
        const workspace = s.workspaces.find((w) => w.id === workspaceId);
        // Cascade: remove all branches (which cascade to worktrees).
        const branches = s.branchesByWorkspaceId[workspaceId] ?? [];
        for (const branch of branches) {
          get().removeBranch(workspaceId, branch.id);
        }
        set((cur) => {
          const { [workspaceId]: _branches, ...restBranches } = cur.branchesByWorkspaceId;
          const { [workspaceId]: _sessions, ...restSessions } = cur.sessionsByWorkspaceId;
          const { [workspaceId]: _worktrees, ...restWorktrees } = cur.worktreesByWorkspaceId;
          const { [workspaceId]: _activeBranch, ...restActiveBranch } =
            cur.activeBranchIdByWorkspaceId;
          const { [workspaceId]: _provider, ...restProviders } = cur.agentProvidersByWorkspaceId;
          return {
            workspaces: cur.workspaces.filter((w) => w.id !== workspaceId),
            branchesByWorkspaceId: restBranches,
            sessionsByWorkspaceId: restSessions,
            worktreesByWorkspaceId: restWorktrees,
            activeBranchIdByWorkspaceId: restActiveBranch,
            agentProvidersByWorkspaceId: restProviders,
          };
        });
        if (workspace) {
          storage.removeWorkspace(workspace.orgId, workspaceId).catch(console.warn);
        }
      },

      setCurrentOrgId: (id) => {
        set({ currentOrgId: id });
      },

      hydrateWorkspacesFromStorage: async (orgId) => {
        try {
          const workspaces = await storage.getWorkspaces(orgId);
          set({ workspaces });
        } catch (e) {
          console.warn("Failed to hydrate workspaces from storage:", e);
        }
      },

      hydrateTasks: async (workspaceId) => {
        const state = get();
        const workspace = state.workspaces.find((w) => w.id === workspaceId);
        if (!workspace || workspace.source.kind !== "remote-agent") return;

        // Idempotency guard: if a provider is already wired (Strict Mode runs
        // effects twice in dev; or another component triggered hydrate), just
        // re-pull the task list and skip listener re-registration to avoid
        // duplicate WS event handlers (which double every upsert/event).
        const existingProvider = state.agentProvidersByWorkspaceId[workspaceId];
        if (existingProvider) {
          try {
            const tasks = await existingProvider.taskList({ workspaceId });
            set((s) => {
              const dismissed = new Set(s.dismissedTaskIds);
              return {
                tasksByWorkspaceId: {
                  ...s.tasksByWorkspaceId,
                  [workspaceId]: tasks.filter((t) => !dismissed.has(t.id)),
                },
              };
            });
          } catch (err) {
            console.warn(`[store.tasks] hydrateTasks refresh failed:`, err);
          }
          return;
        }

        try {
          const provider = new RemoteAgentProvider(
            workspace.source.label,
            workspace.source.url,
            workspace.source.token,
          );
          await provider.connect();

          // Persist the provider to keep event listeners alive
          set((s) => ({
            agentProvidersByWorkspaceId: {
              ...s.agentProvidersByWorkspaceId,
              [workspaceId]: provider,
            },
          }));

          const tasks = await provider.taskList({ workspaceId });

          set((s) => {
            const dismissed = new Set(s.dismissedTaskIds);
            const visibleTasks = tasks.filter((t) => !dismissed.has(t.id));
            // Mirror live tasks as session-tabs so the Workspace surfaces them
            // after refresh. Sort by createdAt ASC so root tasks are processed
            // before their children (ensures conversation aggregation works).
            const sorted = [...visibleTasks].sort(
              (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
            );
            let nextSessions = s.sessionsByWorkspaceId[workspaceId] ?? [];
            for (const t of sorted) {
              nextSessions = buildSessionTabFor(t, sorted, nextSessions);
            }
            return {
              tasksByWorkspaceId: {
                ...s.tasksByWorkspaceId,
                [workspaceId]: visibleTasks,
              },
              sessionsByWorkspaceId: {
                ...s.sessionsByWorkspaceId,
                [workspaceId]: nextSessions,
              },
            };
          });

          provider.onTaskCreated((task) => {
            console.debug("[store.tasks] created", task.id, task.title);
            get().upsertTask(task);
          });

          provider.onTaskStarted((e) => {
            console.debug("[store.tasks] started", e.taskId);
            set((s) => ({
              tasksByWorkspaceId: {
                ...s.tasksByWorkspaceId,
                [workspaceId]: (s.tasksByWorkspaceId[workspaceId] ?? []).map((t) =>
                  t.id === e.taskId
                    ? {
                        ...t,
                        status: "running",
                        startedAt: t.startedAt ?? Date.now(),
                        worktreePath: e.worktreePath ?? t.worktreePath,
                        branchName: e.branchName ?? t.branchName,
                      }
                    : t,
                ),
              },
            }));
            // worktree_path / branch_name are set asynchronously after the
            // started event fires (server emits started BEFORE setupWorktree
            // runs). Re-pull a fresh list so the row carries the branch.
            void provider
              .taskList({ workspaceId })
              .then((fresh) => {
                set((s) => {
                  const dismissed = new Set(s.dismissedTaskIds);
                  const visibleTasks = fresh.filter((t) => !dismissed.has(t.id));
                  // Rebuild session-tabs from fresh list (parent-aware).
                  const sorted = [...visibleTasks].sort(
                    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
                  );
                  let nextSessions = s.sessionsByWorkspaceId[workspaceId] ?? [];
                  for (const t of sorted) {
                    nextSessions = buildSessionTabFor(t, sorted, nextSessions);
                  }
                  return {
                    tasksByWorkspaceId: {
                      ...s.tasksByWorkspaceId,
                      [workspaceId]: visibleTasks,
                    },
                    sessionsByWorkspaceId: {
                      ...s.sessionsByWorkspaceId,
                      [workspaceId]: nextSessions,
                    },
                  };
                });
              })
              .catch(() => {});
          });

          provider.onTaskEvent((e) => {
            // Verbose stream — kept at debug to avoid console spam.
            console.debug("[store.tasks] event", e.taskId, e.event);
            const entry: import("@/lib/fs/remote-agent").TaskLogEntry = {
              id: -1,
              taskId: e.taskId,
              ts: Date.now(),
              level: "info",
              source: "stdout",
              data: e.event,
            };
            set((s) => {
              const cur = s.taskEventsByTaskId[e.taskId] ?? [];
              const next = cur.length >= 2000 ? [...cur.slice(-1999), entry] : [...cur, entry];
              return {
                taskEventsByTaskId: { ...s.taskEventsByTaskId, [e.taskId]: next },
              };
            });
          });

          provider.onTaskEnded((e) => {
            console.debug("[store.tasks] ended", e.taskId, e.status);
            set((s) => ({
              tasksByWorkspaceId: {
                ...s.tasksByWorkspaceId,
                [workspaceId]: (s.tasksByWorkspaceId[workspaceId] ?? []).map((t) =>
                  t.id === e.taskId
                    ? {
                        ...t,
                        status: e.status,
                        exitCode: e.exitCode,
                        errorMessage: e.errorMessage,
                        endedAt: t.endedAt ?? Date.now(),
                      }
                    : t,
                ),
              },
            }));
            // Final pull to capture any field set during the run
            // (worktree_path, exit_code, error_message, etc.)
            void provider
              .taskList({ workspaceId })
              .then((fresh) => {
                set((s) => {
                  const dismissed = new Set(s.dismissedTaskIds);
                  return {
                    tasksByWorkspaceId: {
                      ...s.tasksByWorkspaceId,
                      [workspaceId]: fresh.filter((t) => !dismissed.has(t.id)),
                    },
                  };
                });
              })
              .catch(() => {});
          });

          provider.onTaskWorktreeRemoved((e) => {
            console.debug("[store.tasks] worktreeRemoved", e.taskId);
            get().removeTaskById(e.taskId);
          });
        } catch (err) {
          console.warn(`[store] hydrateTasks failed for workspace ${workspaceId}:`, err);
        }
      },

      setActiveTask: (id) => {
        set({ activeTaskId: id });
        if (!id) return;
        const state = get();
        // Locate the workspace that owns this task to also activate its session tab.
        for (const [wsId, tasks] of Object.entries(state.tasksByWorkspaceId)) {
          const t = tasks.find((task) => task.id === id);
          if (t) {
            const sessionId = t.sessionId ?? `${id}-session`;
            set((s) => ({
              activeSessionIdByWorkspaceId: {
                ...s.activeSessionIdByWorkspaceId,
                [wsId]: sessionId,
              },
            }));
            break;
          }
        }
        if (!state.taskEventsByTaskId[id]) {
          void state.loadTaskLogs(id);
        }
        void state.openTaskSession(id);
      },

      setTaskDetailDialogOpen: (taskId) => {
        set({ taskDetailDialogTaskId: taskId });
      },

      openNewTaskDialog: (prefillCli) => {
        set((s) => ({
          newTaskDialogOpen: true,
          activeAgent: prefillCli ?? s.activeAgent,
        }));
      },

      closeNewTaskDialog: () => {
        set({ newTaskDialogOpen: false });
      },

      createTaskFromPrompt: async (prompt, options = {}) => {
        const state = get();
        const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
        if (!workspace || workspace.source.kind !== "remote-agent") {
          toast.error("Active workspace is not a remote agent");
          return;
        }

        const cli = (options.cli as any) ?? state.activeAgent;
        const model = options.model ?? state.selectedModelByCli[cli];
        const effort = options.effort;

        try {
          console.info(
            `[store.createTaskFromPrompt] creating task ws=${workspace.id} cli=${cli} prompt=${prompt.length} chars`,
          );
          // Reuse the persisted provider so we don't double-subscribe to WS events
          // (a fresh provider would mean two task.created/event/ended listeners,
          // causing every event handler to fire twice → duplicate keys in React).
          let provider = state.agentProvidersByWorkspaceId[workspace.id];
          if (!provider) {
            provider = new RemoteAgentProvider(
              workspace.source.label,
              workspace.source.url,
              workspace.source.token,
            );
            await provider.connect();
            set((s) => ({
              agentProvidersByWorkspaceId: {
                ...s.agentProvidersByWorkspaceId,
                [workspace.id]: provider!,
              },
            }));
          }

          const { id: taskId, sessionId } = await provider.taskCreate({
            workspaceId: workspace.id,
            title: prompt.split("\n")[0].slice(0, 60) || "Untitled task",
            prompt,
            cli,
            model,
            effort,
          });
          console.info(
            `[store.createTaskFromPrompt] taskCreate ok id=${taskId} sessionId=${sessionId}`,
          );

          await provider.taskStart(taskId);
          console.info(`[store.createTaskFromPrompt] taskStart ok id=${taskId}`);

          const cliKind = cli as TerminalKind;
          const synthTask: import("@/lib/fs/remote-agent").Task = {
            id: taskId,
            sessionId,
            workspaceId: workspace.id,
            title: prompt.split("\n")[0].slice(0, 40),
            prompt,
            cli,
            model: model ?? null,
            effort: effort ?? null,
            status: "running",
            worktreePath: null,
            branchName: null,
            baseRef: null,
            exitCode: null,
            errorMessage: null,
            parentSessionId: null,
            createdAt: Date.now(),
            startedAt: Date.now(),
            endedAt: null,
          };
          set((s) => {
            // Dedup by id — if the `task.created` WS event already populated
            // tasksByWorkspaceId before this set runs (race), don't push twice.
            const allTasks = s.tasksByWorkspaceId[workspace.id] ?? [];
            const tasksWithSynth = allTasks.some((t) => t.id === synthTask.id)
              ? allTasks
              : [...allTasks, synthTask];
            const existing = s.sessionsByWorkspaceId[workspace.id] ?? [];
            const nextSessions = buildSessionTabFor(synthTask, tasksWithSynth, existing);
            return {
              tasksByWorkspaceId: {
                ...s.tasksByWorkspaceId,
                [workspace.id]: tasksWithSynth,
              },
              sessionsByWorkspaceId: {
                ...s.sessionsByWorkspaceId,
                [workspace.id]: nextSessions,
              },
              activeSessionIdByWorkspaceId: {
                ...s.activeSessionIdByWorkspaceId,
                [workspace.id]: sessionId,
              },
              activeAgent: cliKind,
              activeTaskId: taskId,
            };
          });
          toast.success("Task created and started");
        } catch (err) {
          console.error("[store.createTaskFromPrompt] failed:", err);
          toast.error(err instanceof Error ? err.message : "Failed to create task");
        }
      },

      upsertTask: (task) => {
        set((s) => {
          const tasks = s.tasksByWorkspaceId[task.workspaceId] ?? [];
          const idx = tasks.findIndex((t) => t.id === task.id);
          const nextTasks = idx >= 0 ? [...tasks] : [...tasks, task];
          if (idx >= 0) nextTasks[idx] = task;

          const existingSessions = s.sessionsByWorkspaceId[task.workspaceId] ?? [];
          const nextSessions = buildSessionTabFor(task, nextTasks, existingSessions);

          return {
            tasksByWorkspaceId: { ...s.tasksByWorkspaceId, [task.workspaceId]: nextTasks },
            sessionsByWorkspaceId: {
              ...s.sessionsByWorkspaceId,
              [task.workspaceId]: nextSessions,
            },
          };
        });
      },

      removeTaskById: (taskId) => {
        set((s) => {
          const next: typeof s.tasksByWorkspaceId = {};
          // Capture the matching task's sessionId before we drop it, so we can
          // also evict the mirrored session-tab.
          let sessionIdToDrop: string | null = null;
          let workspaceIdOfDrop: string | null = null;
          for (const [wsId, tasks] of Object.entries(s.tasksByWorkspaceId)) {
            const match = tasks.find((t) => t.id === taskId);
            if (match) {
              sessionIdToDrop = match.sessionId;
              workspaceIdOfDrop = wsId;
            }
            next[wsId] = tasks.filter((t) => t.id !== taskId);
          }
          // Drop the cached transcript too — task is gone, no point keeping it.
          const evNext = { ...s.taskEventsByTaskId };
          delete evNext[taskId];
          // Tombstone the id so future `taskList` re-pulls don't resurrect
          // the row (covers the case where the agent backend hasn't
          // received the `tasksRepo.delete` patch yet). Keep last 200 ids.
          const cur = s.dismissedTaskIds;
          const dismissed = cur.includes(taskId) ? cur : [taskId, ...cur].slice(0, 200);

          // Evict mirrored session-tab + active-session pointer.
          let nextSessions = s.sessionsByWorkspaceId;
          let nextActive = s.activeSessionIdByWorkspaceId;
          if (sessionIdToDrop && workspaceIdOfDrop) {
            const list = s.sessionsByWorkspaceId[workspaceIdOfDrop] ?? [];
            nextSessions = {
              ...s.sessionsByWorkspaceId,
              [workspaceIdOfDrop]: list.filter((t) => t.id !== sessionIdToDrop),
            };
            if (s.activeSessionIdByWorkspaceId[workspaceIdOfDrop] === sessionIdToDrop) {
              const remaining = nextSessions[workspaceIdOfDrop];
              const fallback = remaining[remaining.length - 1]?.id;
              nextActive = { ...s.activeSessionIdByWorkspaceId };
              if (fallback) nextActive[workspaceIdOfDrop] = fallback;
              else delete nextActive[workspaceIdOfDrop];
            }
          }

          return {
            tasksByWorkspaceId: next,
            taskEventsByTaskId: evNext,
            activeTaskId: s.activeTaskId === taskId ? null : s.activeTaskId,
            dismissedTaskIds: dismissed,
            sessionsByWorkspaceId: nextSessions,
            activeSessionIdByWorkspaceId: nextActive,
          };
        });
      },

      loadTaskLogs: async (taskId) => {
        const state = get();
        // Find which workspace owns this task to derive the provider.
        let workspace: Workspace | undefined;
        for (const [wsId, tasks] of Object.entries(state.tasksByWorkspaceId)) {
          if (tasks.some((t) => t.id === taskId)) {
            workspace = state.workspaces.find((w) => w.id === wsId);
            break;
          }
        }
        if (!workspace || workspace.source.kind !== "remote-agent") return;
        try {
          // Reuse the persisted provider; creating new ones double-subscribes
          // every WS event listener.
          let provider = state.agentProvidersByWorkspaceId[workspace.id];
          if (!provider) {
            provider = new RemoteAgentProvider(
              workspace.source.label,
              workspace.source.url,
              workspace.source.token,
            );
            await provider.connect();
            set((s) => ({
              agentProvidersByWorkspaceId: {
                ...s.agentProvidersByWorkspaceId,
                [workspace.id]: provider!,
              },
            }));
          }
          const rows = await provider.taskLogsList({ taskId, limit: 2000 });
          set((s) => ({
            taskEventsByTaskId: { ...s.taskEventsByTaskId, [taskId]: rows },
          }));
        } catch (err) {
          console.warn(`[store.tasks] loadTaskLogs failed for ${taskId}:`, err);
        }
      },

      openTaskSession: async (taskId) => {
        const state = get();
        // Find which workspace owns this task.
        let workspace: Workspace | undefined;
        for (const [wsId, tasks] of Object.entries(state.tasksByWorkspaceId)) {
          if (tasks.some((t) => t.id === taskId)) {
            workspace = state.workspaces.find((w) => w.id === wsId);
            break;
          }
        }
        if (!workspace || workspace.source.kind !== "remote-agent") return;

        const sessionId = `${taskId}-session`;
        try {
          const provider =
            state.agentProvidersByWorkspaceId[workspace.id] ??
            new RemoteAgentProvider(
              workspace.source.label,
              workspace.source.url,
              workspace.source.token,
            );
          if (!state.agentProvidersByWorkspaceId[workspace.id]) {
            await provider.connect();
            set((s) => ({
              agentProvidersByWorkspaceId: {
                ...s.agentProvidersByWorkspaceId,
                [workspace.id]: provider,
              },
            }));
          }

          // Lazily create session in DB if not already present (idempotent)
          const taskList = await provider.taskList({ workspaceId: workspace.id });
          const task = taskList.find((t) => t.id === taskId);
          if (!task?.sessionId) {
            await provider.sessionsCreate({
              id: sessionId,
              workspaceId: workspace.id,
              cli: task?.cli ?? "codex",
              title: task?.title,
            });
            // Link the session to the task
            await provider.taskUpdate(taskId, { sessionId });
          }
        } catch (err) {
          console.warn(`[store.tasks] openTaskSession failed for ${taskId}:`, err);
        }
      },

      createFolder: (name) => {
        const sk = getCurrentScopeKey(get());
        void get().createEntry(sk, "", name, "dir");
      },

      createFile: (folder, name) => {
        const sk = getCurrentScopeKey(get());
        void get().createEntry(sk, folder ?? "", name, "file");
      },

      deleteEntry: (folder, name) => {
        const s = get();
        const sk = getCurrentScopeKey(s);
        const path = folder ? `${folder}/${name}` : name;

        // Ferme l'onglet si le fichier est ouvert
        const openFiles = s.openFilesByScope[sk] ?? [];
        const tabId: `file:${string}` = `file:${path}`;
        if (openFiles.some((f) => f.id === tabId)) {
          s.closeFile(tabId);
        }

        void get().removeEntry(sk, path);
      },

      openFile: (path) => {
        const state = get();
        const key = scopeKey(state.activeWorkspaceId, state.activeBranchId);
        const id: `file:${string}` = `file:${path}`;
        const current = state.openFilesByScope[key] ?? [];
        const exists = current.some((f) => f.id === id);

        if (exists) {
          set((s) => ({
            activeTabByScope: { ...s.activeTabByScope, [key]: id },
          }));
          return;
        }

        const binary = isBinaryPath(path);
        const newTab: FileTab = { id, path, content: null, loading: !binary, isBinary: binary };

        set((s) => ({
          openFilesByScope: {
            ...s.openFilesByScope,
            [key]: [...(s.openFilesByScope[key] ?? []), newTab],
          },
          activeTabByScope: { ...s.activeTabByScope, [key]: id },
        }));

        if (binary) return;

        const ws = workspaceForScope(state.workspaces, key);
        if (!ws) return;

        (async () => {
          try {
            const provider = await providerFor(
              ws.source,
              ws.name,
              ws.source.kind === "mock" ? MOCK_PROVIDER_TREE : undefined,
            );

            const text = await provider.readFile(path);

            set((s) => {
              const files = s.openFilesByScope[key] ?? [];
              return {
                openFilesByScope: {
                  ...s.openFilesByScope,
                  [key]: files.map((f) =>
                    f.id === id ? { ...f, content: text, loading: false } : f,
                  ),
                },
              };
            });
          } catch (e) {
            const msg = e instanceof FsError ? e.message : "Failed to read file";
            toast.error(msg);
            set((s) => {
              const files = s.openFilesByScope[key] ?? [];
              return {
                openFilesByScope: {
                  ...s.openFilesByScope,
                  [key]: files.map((f) =>
                    f.id === id ? { ...f, content: null, loading: false, error: msg } : f,
                  ),
                },
              };
            });
          }
        })();
      },

      saveFile: async (tabId) => {
        const state = get();
        const key = scopeKey(state.activeWorkspaceId, state.activeBranchId);
        const activeId = tabId ?? (state.activeTabByScope[key] as `file:${string}` | undefined);
        if (!activeId?.startsWith("file:")) return;

        const files = state.openFilesByScope[key] ?? [];
        const tab = files.find((f) => f.id === activeId);
        if (!tab || !tab.isDirty || tab.content === null) return;

        const ws = workspaceForScope(state.workspaces, key);
        if (!ws) return;

        try {
          const provider = await providerFor(
            ws.source,
            ws.name,
            ws.source.kind === "mock" ? MOCK_PROVIDER_TREE : undefined,
          );

          await provider.writeFile(tab.path, tab.content);

          set((s) => {
            const f = s.openFilesByScope[key] ?? [];
            return {
              openFilesByScope: {
                ...s.openFilesByScope,
                [key]: f.map((t) => (t.id === activeId ? { ...t, isDirty: false } : t)),
              },
            };
          });
          scheduleGitRefresh(key, get);
          toast.success(`Saved ${tab.path}`);
        } catch (e) {
          const msg = e instanceof FsError ? e.message : "Failed to save file";
          toast.error(msg);
        }
      },

      updateFileContent: (tabId, content) =>
        set((s) => {
          const key = scopeKey(s.activeWorkspaceId, s.activeBranchId);
          const files = s.openFilesByScope[key] ?? [];
          return {
            openFilesByScope: {
              ...s.openFilesByScope,
              [key]: files.map((f) => (f.id === tabId ? { ...f, content, isDirty: true } : f)),
            },
          };
        }),

      closeFile: (id) =>
        set((s) => {
          const key = scopeKey(s.activeWorkspaceId, s.activeBranchId);
          const current = s.openFilesByScope[key] ?? [];
          const openFiles = current.filter((f) => f.id !== id);
          const wasActive = (s.activeTabByScope[key] ?? "overview") === id;
          const next: TabId = wasActive
            ? (openFiles[openFiles.length - 1]?.id ?? "overview")
            : (s.activeTabByScope[key] ?? "overview");
          return {
            openFilesByScope: { ...s.openFilesByScope, [key]: openFiles },
            activeTabByScope: { ...s.activeTabByScope, [key]: next },
          };
        }),
    }),
    {
      name: "ide-ux-agentik",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (_persistedState, _version) => _persistedState as State,
      partialize: (state) =>
        ({
          activeWorkspaceId: state.activeWorkspaceId,
          activeBranchIdByWorkspaceId: state.activeBranchIdByWorkspaceId,
          activeSessionIdByWorkspaceId: state.activeSessionIdByWorkspaceId,
          pinnedSessionIdsByWorkspaceId: state.pinnedSessionIdsByWorkspaceId,
          selectedModelByCli: state.selectedModelByCli,
          approvalModeByCli: state.approvalModeByCli,
          settingsSidebarCollapsed: state.settingsSidebarCollapsed,
          dismissedTaskIds: state.dismissedTaskIds,
        }) as State,
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("[store] rehydration error:", error);
        }
        // Defer one tick: the `useIDE` const isn't bound yet while create()
        // is still returning, and calling useIDE.getState() synchronously
        // would hit a TDZ. The rehydrated `state` snapshot carries the
        // action already.
        setTimeout(() => {
          try {
            useIDE.setState({ _hydrated: true });
            if (!error) void state?.hydrateSessionsFromDb();
          } catch (e) {
            console.warn("[store] hydrateSessionsFromDb failed:", e);
          }
        }, 0);
      },
    },
  ),
);

// ─── Development test hooks ───────────────────────────────────────────────────

if (import.meta.env.DEV && typeof window !== "undefined") {
  import("@/lib/chat/codex-conversation-reducer").then(({ reduceCodexEvents }) => {
    (window as any).__test = {
      ...(window as any).__test,
      reduceCodex: reduceCodexEvents,
    };
  });

  (window as any).__test = {
    seedTask: (task: import("@/lib/fs/remote-agent").Task) => {
      useIDE.getState().upsertTask(task);
    },
    pushTaskEvent: (taskId: string, event: unknown) => {
      useIDE.setState((s) => {
        const cur = s.taskEventsByTaskId[taskId] ?? [];
        const entry = {
          id: -1,
          taskId,
          ts: Date.now(),
          level: "info" as const,
          source: "stdout" as const,
          data: event,
        };
        return {
          taskEventsByTaskId: {
            ...s.taskEventsByTaskId,
            [taskId]: [...cur, entry as any],
          },
        };
      });
    },
    getStore: () => useIDE.getState(),
  };
}

// ─── Derived-scope hooks ──────────────────────────────────────────────────────

export function useStoreHydrated(): boolean {
  return useIDE((s) => s._hydrated);
}

export function useCurrentScopeKey(): ScopeKey {
  const ws = useIDE((s) => s.activeWorkspaceId);
  const br = useIDE((s) => s.activeBranchId);
  return scopeKey(ws, br);
}

export function useCurrentOpenFiles(): FileTab[] {
  const key = useCurrentScopeKey();
  return useIDE((s) => s.openFilesByScope[key] ?? EMPTY_FILES);
}

export function useCurrentActiveTab(): TabId {
  const key = useCurrentScopeKey();
  return useIDE((s) => s.activeTabByScope[key] ?? "overview");
}

export function useCurrentExpandedFolders(): Record<string, boolean> {
  const key = useCurrentScopeKey();
  return useIDE((s) => s.expandedFoldersByScope[key] ?? EMPTY_FOLDERS);
}

export function useCurrentMessages(): ChatMessage[] {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const activeSessionId = useIDE((s) => s.activeSessionIdByWorkspaceId[workspaceId]);
  return useIDE(
    (s) => (activeSessionId ? s.messagesBySessionId[activeSessionId] : undefined) ?? EMPTY_MESSAGES,
  );
}

export const TOKEN_CONTEXT_MAX = 200_000;

export function useTokenEstimate(): { used: number; max: number } {
  const messages = useCurrentMessages();
  return useMemo(() => {
    const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return { used: Math.round(chars / 4), max: TOKEN_CONTEXT_MAX };
  }, [messages]);
}

// Returns tasks for the active worktree (derived from activeWorktreeIdByScope).
export function useCurrentTasks(): WorkTask[] {
  const key = useCurrentScopeKey();
  const worktreeId = useIDE((s) => s.activeWorktreeIdByScope[key]);
  return useIDE((s) => (worktreeId ? s.tasksByWorktreeId[worktreeId] : undefined) ?? EMPTY_TASKS);
}

// Helper: all branches for the active workspace.
export function useCurrentBranches(): Branch[] {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  return useIDE((s) => s.branchesByWorkspaceId[workspaceId] ?? EMPTY_BRANCHES);
}

export function useCurrentWorktrees(): Worktree[] {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const branchId = useIDE((s) => s.activeBranchId);
  const byWorkspace = useIDE((s) => s.worktreesByWorkspaceId[workspaceId] ?? EMPTY_WORKTREES);
  return useMemo(
    () => byWorkspace.filter((wt) => wt.branchId === branchId),
    [byWorkspace, branchId],
  );
}

export function useProjectWorktrees(): Worktree[] {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  return useIDE((s) => s.worktreesByWorkspaceId[workspaceId] ?? EMPTY_WORKTREES);
}

export function useCurrentWorktree(): Worktree | undefined {
  const key = useCurrentScopeKey();
  const activeWorktreeId = useIDE((s) => s.activeWorktreeIdByScope[key]);
  const worktrees = useCurrentWorktrees();
  return useMemo(
    () => worktrees.find((wt) => wt.id === activeWorktreeId) ?? worktrees[0],
    [worktrees, activeWorktreeId],
  );
}

const EMPTY_SESSIONS: WorkspaceTerminal[] = [];

export function useCurrentSessions(): WorkspaceTerminal[] {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  return useIDE((s) => s.sessionsByWorkspaceId[workspaceId] ?? EMPTY_SESSIONS);
}

export function useActiveSession(): WorkspaceTerminal | undefined {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const activeId = useIDE((s) => s.activeSessionIdByWorkspaceId[workspaceId]);
  const sessions = useCurrentSessions();
  return useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId],
  );
}

const EMPTY_PINS: string[] = [];

export function usePinnedSessionIds(): string[] {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  return useIDE((s) => s.pinnedSessionIdsByWorkspaceId[workspaceId] ?? EMPTY_PINS);
}

const EMPTY_FILES: FileTab[] = [];
const EMPTY_FOLDERS: Record<string, boolean> = {};
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_TASKS: WorkTask[] = [];
const EMPTY_WORKTREES: Worktree[] = [];
const EMPTY_BRANCHES: Branch[] = [];

export function useCurrentTree(): TreeNode | undefined {
  const key = useCurrentScopeKey();
  return useIDE((s) => s.treeByScope[key]);
}

export const EMPTY_GIT_STATUS: GitStatusMap = new Map();

export function useCurrentGitStatus(): GitStatusMap {
  const key = useCurrentScopeKey();
  return useIDE((s) => s.gitStatusByScope[key] ?? EMPTY_GIT_STATUS);
}

// ─── Task-centric selectors (Wave 1) ─────────────────────────────────────────
// `activeTaskId` is the primary navigation pointer. Thread renders the task
// it points to; sidebar highlights it; URL ?task=<id> mirrors it.

import type { Task as RemoteTask, TaskLogEntry } from "@/lib/fs/remote-agent";

const EMPTY_TASK_EVENTS: TaskLogEntry[] = [];

export function useActiveTaskId(): string | null {
  return useIDE((s) => s.activeTaskId);
}

export function useActiveTask(): RemoteTask | null {
  return useIDE((s) => {
    if (!s.activeTaskId) return null;
    for (const tasks of Object.values(s.tasksByWorkspaceId)) {
      const found = tasks.find((t) => t.id === s.activeTaskId);
      if (found) return found;
    }
    return null;
  });
}

export function useActiveTaskEvents(): TaskLogEntry[] {
  return useIDE((s) =>
    s.activeTaskId
      ? (s.taskEventsByTaskId[s.activeTaskId] ?? EMPTY_TASK_EVENTS)
      : EMPTY_TASK_EVENTS,
  );
}

export function useActiveTaskWorkspace(): Workspace | null {
  return useIDE((s) => {
    if (!s.activeTaskId) return null;
    for (const [wsId, tasks] of Object.entries(s.tasksByWorkspaceId)) {
      if (tasks.some((t) => t.id === s.activeTaskId)) {
        return s.workspaces.find((w) => w.id === wsId) ?? null;
      }
    }
    return null;
  });
}

/** Alias for setActiveTask — Multica-style vocabulary. Lazy-loads logs + session. */
export function useSelectTask(): (taskId: string | null) => void {
  return useIDE((s) => s.setActiveTask);
}

function generateAssistantReply(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("hello") || p.includes("hi") || p.includes("salut") || p.includes("bonjour")) {
    return "Hello! I'm running on Opus 4.6 with a 1M context window. Ask me about the codebase, architecture, or any specific crate.";
  }
  if (p.includes("test")) {
    return "Tests live alongside each crate. Run `just test` to execute the full suite, or `cargo test -p sc_diff` for a single crate. Integration tests are in `crates/sc_app/tests/`.";
  }
  if (p.includes("build") || p.includes("compile")) {
    return "Use `just r` for a debug build and `just rr` for a release build. Release uses thin LTO with a single codegen unit; dev uses high codegen-units for fast incremental compilation.";
  }
  if (p.includes("architecture") || p.includes("structure")) {
    return "The app is built around 31 Rust crates organized into 6 layers: Core services, UI views, State/session, Integration, Rendering, and Composition. The worktree is the primary unit — terminals, git services, and PR data are all keyed by it.";
  }
  return `Working on it. Based on "${prompt.slice(0, 80)}", here's what I'd look at first:\n\n1. Check the relevant crate in \`crates/\`\n2. Look at the service layer for background work\n3. UI views render to GPU via Metal — main thread is render-only\n\nWant me to open a specific file?`;
}
