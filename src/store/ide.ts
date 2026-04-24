import { useMemo } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { providerFor, FsError, type FsEntry } from "@/lib/fs";
import { computeStatus, type GitStatusMap } from "@/lib/git/status";

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

export type BranchTask = {
  id: string;
  branchId: string;
  title: string;
  status: TaskStatus;
  assignee: string;
  updatedAt: string;
};

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

export type Workspace = {
  id: string;
  letter: string;
  name: string;
  color: string;
  gitUrl?: string;
  branches: Branch[];
  source: WorkspaceSource;
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
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp",
  "pdf", "zip", "tar", "gz", "bz2", "xz", "7z", "rar",
  "mp3", "mp4", "mov", "avi", "webm", "wav", "flac", "ogg",
  "woff", "woff2", "ttf", "otf", "eot",
  "wasm", "bin", "so", "dylib", "dll", "exe",
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

  // Scoped per (workspace, branch)
  messagesByScope: Record<ScopeKey, ChatMessage[]>;
  openFilesByScope: Record<ScopeKey, FileTab[]>;
  activeTabByScope: Record<ScopeKey, TabId>;
  expandedFoldersByScope: Record<ScopeKey, Record<string, boolean>>;
  activeWorktreeIdByScope: Record<ScopeKey, string>;
  tasksByBranchId: Record<string, BranchTask[]>;
  worktreesByWorkspaceId: Record<string, Worktree[]>;
  sessionsByWorkspaceId: Record<string, WorkspaceTerminal[]>;
  activeSessionIdByWorkspaceId: Record<string, string>;

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
  thinking: boolean;
  webSearch: boolean;

  branchesLoading: boolean;
  worktreesLoading: boolean;
  tasksLoading: boolean;
  fileTreeLoading: boolean;
  hydrate: () => void;

  // Flat legacy fields (kept for rétrocompat avec FilesPanel)
  fileTree: Record<string, string[]>;
  rootFiles: string[];

  // New scoped tree structure
  treeByScope: Record<ScopeKey, TreeNode>;
  loadingPaths: Record<ScopeKey, Record<string, boolean>>;

  // Git status par scope
  gitStatusByScope: Record<ScopeKey, GitStatusMap>;
  refreshGitStatus: (scopeKey: ScopeKey) => Promise<void>;

  // Vague 2 stubs
  loadRoot: (scopeKey: ScopeKey) => Promise<void>;
  loadChildren: (scopeKey: ScopeKey, path: string) => Promise<void>;
  createEntry: (scopeKey: ScopeKey, parentPath: string, name: string, type: "dir" | "file") => Promise<void>;
  removeEntry: (scopeKey: ScopeKey, path: string) => Promise<void>;

  setActiveWorkspace: (id: string) => void;
  setActiveBranch: (id: string) => void;
  setActiveTab: (id: TabId) => void;
  setActiveWorktree: (id: string) => void;
  toggleFolder: (name: string) => void;
  toggleFiles: () => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  toggleAgentPanel: () => void;
  setApplyingFromUrl: (v: boolean) => void;
  setActiveAgent: (k: TerminalKind) => void;
  setActiveSession: (sessionId: string) => void;
  addAgentSession: (kind: TerminalKind) => void;
  closeAgentSession: (sessionId: string) => void;
  togglePreview: () => void;
  setTheme: (t: Theme) => void;
  setFilesTab: (t: "files" | "changes" | "checks") => void;
  toggleThinking: () => void;
  toggleWebSearch: () => void;
  sendMessage: (content: string) => void;
  addBranch: (workspaceId: string, name: string) => void;
  toggleStar: (branchId: string) => void;
  addWorkspace: (name: string, source?: WorkspaceSource) => void;
  addTask: (branchId: string, title: string) => void;
  cycleTaskStatus: (branchId: string, taskId: string) => void;
  setTaskStatus: (branchId: string, taskId: string, status: TaskStatus) => void;
  addWorktree: (workspaceId: string, branchId: string, name?: string) => void;
  addTerminal: (worktreeId: string, kind: TerminalKind) => string;

  createFolder: (name: string) => void;
  createFile: (folder: string | null, name: string) => void;
  deleteEntry: (folder: string | null, name: string) => void;
  openFile: (path: string) => void;
  closeFile: (id: `file:${string}`) => void;
  saveFile: (tabId?: TabId) => Promise<void>;
  updateFileContent: (tabId: `file:${string}`, content: string) => void;

  getWorkspaceIdForBranch: (branchId: string) => string | undefined;
};

const initialWorkspaces: Workspace[] = [
  {
    id: "ws-sc",
    letter: "S",
    name: "superconductor",
    color: "oklch(0.45 0.18 270)",
    gitUrl: "https://github.com/superconductor/superconductor",
    source: { kind: "mock", id: "ws-sc" },
    branches: [
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
  },
  {
    id: "ws-landing",
    letter: "L",
    name: "landing",
    color: "oklch(0.55 0.13 60)",
    gitUrl: "https://github.com/superconductor/landing",
    source: { kind: "mock", id: "ws-landing" },
    branches: [
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
  },
];

const seedMessage: ChatMessage = {
  id: "seed",
  role: "user",
  content: "explain this codebase",
};

// Mini mock tree for workspaces with kind="mock" — fallback until Vague 2 loads real data
const MOCK_FILE_TREE: Record<string, string[]> = {
  crates: ["sc_app/", "sc_git/", "sc_diff/"],
  docs: ["ARCHITECTURE.md", "CONTRIBUTING.md"],
  scripts: ["release.sh"],
};

const MOCK_ROOT_FILES = [
  "Cargo.toml",
  "Cargo.lock",
  "README.md",
  ".gitignore",
];

// Initial in-memory tree provided to MockProvider instances
const MOCK_PROVIDER_TREE = {
  crates: { sc_app: {}, sc_git: {}, sc_diff: {} },
  docs: { "ARCHITECTURE.md": "# Architecture\n\nMock doc.\n", "CONTRIBUTING.md": "# Contributing\n\nMock doc.\n" },
  scripts: { "release.sh": "#!/usr/bin/env bash\nset -euo pipefail\n" },
  "Cargo.toml": "[package]\nname = \"superconductor\"\nversion = \"0.1.0\"\n",
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

function entriesToTreeNodes(entries: FsEntry[], parentPath: string): TreeNode[] {
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

function getCurrentScopeKey(state: { activeWorkspaceId: string; activeBranchId: string }): ScopeKey {
  return scopeKey(state.activeWorkspaceId, state.activeBranchId);
}

function workspaceForScope(workspaces: Workspace[], sk: ScopeKey) {
  const [wsId] = sk.split(":") as [string, string];
  return workspaces.find((w) => w.id === wsId);
}

function flatFieldsFromEntries(
  entries: FsEntry[],
): { fileTree: Record<string, string[]>; rootFiles: string[] } {
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

function mockFileContent(path: string): string {
  const name = path.split("/").pop() ?? path;
  if (name.endsWith(".md")) {
    return `# ${name.replace(".md", "")}\n\nMock documentation file.\n`;
  }
  if (name.endsWith(".toml")) {
    return `# ${name}\n[package]\nname = "mock"\nversion = "0.1.0"\n`;
  }
  if (name.endsWith(".json")) {
    return `{\n  "name": "${name}",\n  "mock": true\n}\n`;
  }
  if (name.endsWith(".rs")) {
    return `fn main() {\n    println!("Hello from ${name}");\n}\n`;
  }
  if (name.endsWith(".sh")) {
    return `#!/usr/bin/env bash\nset -euo pipefail\necho "Running ${name}"\n`;
  }
  return `// ${path}\n// Mock file content\n`;
}

function makeScopeRootNode(sk: ScopeKey): TreeNode {
  return { path: "", name: "", type: "dir", children: [], loaded: false };
}

function isMockWorkspace(workspaces: Workspace[], workspaceId: string): boolean {
  const ws = workspaces.find((w) => w.id === workspaceId);
  return ws?.source.kind === "mock";
}

const INITIAL_SCOPE = scopeKey("ws-sc", "b1");

let gitDebounceHandle: ReturnType<typeof setTimeout> | null = null;
function scheduleGitRefresh(sk: ScopeKey, getStore: () => { refreshGitStatus: (sk: ScopeKey) => Promise<void> }) {
  if (gitDebounceHandle) clearTimeout(gitDebounceHandle);
  gitDebounceHandle = setTimeout(() => { void getStore().refreshGitStatus(sk); }, 300);
}

function createTerminalSet(_worktreeId: string): WorkspaceTerminal[] {
  return [];
}

const initialWorktrees: Record<string, Worktree[]> = {
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
};

const initialTasksByBranchId: Record<string, BranchTask[]> = {
  b1: [
    {
      id: "task-b1-1",
      branchId: "b1",
      title: "Stabilize workspace bootstrap",
      status: "in_progress",
      assignee: "Codex",
      updatedAt: "12m ago",
    },
    {
      id: "task-b1-2",
      branchId: "b1",
      title: "Review multi-worktree session model",
      status: "todo",
      assignee: "Claude",
      updatedAt: "1h ago",
    },
  ],
  b2: [
    {
      id: "task-b2-1",
      branchId: "b2",
      title: "Ship meta chat timeline",
      status: "blocked",
      assignee: "Gemini",
      updatedAt: "4m ago",
    },
    {
      id: "task-b2-2",
      branchId: "b2",
      title: "Rebase worktree on master",
      status: "todo",
      assignee: "OpenCode",
      updatedAt: "18m ago",
    },
  ],
  b6: [
    {
      id: "task-b6-1",
      branchId: "b6",
      title: "Persist workspace sidebar collapse state",
      status: "in_progress",
      assignee: "Codex",
      updatedAt: "9m ago",
    },
  ],
  l2: [
    {
      id: "task-l2-1",
      branchId: "l2",
      title: "Refresh hero copy",
      status: "done",
      assignee: "Claude",
      updatedAt: "1d ago",
    },
    {
      id: "task-l2-2",
      branchId: "l2",
      title: "QA responsive navbar",
      status: "todo",
      assignee: "Codex",
      updatedAt: "39m ago",
    },
  ],
};

function getDefaultWorktreeId(
  worktreesByWorkspaceId: Record<string, Worktree[]>,
  workspaceId: string,
  branchId: string,
): string | undefined {
  const worktrees = worktreesByWorkspaceId[workspaceId] ?? [];
  return worktrees.find((wt) => wt.branchId === branchId)?.id ?? worktrees[0]?.id;
}

export const useIDE = create<State>((set, get) => ({
  workspaces: initialWorkspaces,
  activeWorkspaceId: "ws-sc",
  activeBranchId: "b1",

  messagesByScope: { [INITIAL_SCOPE]: [seedMessage] },
  openFilesByScope: {},
  activeTabByScope: { [INITIAL_SCOPE]: "overview" },
  expandedFoldersByScope: { [INITIAL_SCOPE]: { crates: true } },
  activeWorktreeIdByScope: { [INITIAL_SCOPE]: "wt-sc-main" },
  tasksByBranchId: initialTasksByBranchId,
  worktreesByWorkspaceId: initialWorktrees,
  sessionsByWorkspaceId: {},
  activeSessionIdByWorkspaceId: {},

  theme: readStoredTheme(),
  showFiles: true,
  showSidebar: true,
  showTerminal: false,
  showAgentPanel: false,
  applyingFromUrl: false,
  activeAgent: "claude",
  previewMode: false,
  filesTab: "files",
  thinking: true,
  webSearch: false,

  branchesLoading: true,
  worktreesLoading: true,
  tasksLoading: true,
  fileTreeLoading: true,
  hydrate: () => {
    set({
      branchesLoading: false,
      worktreesLoading: false,
      tasksLoading: false,
      fileTreeLoading: false,
    });
  },

  // Legacy flat fields — kept for rétrocompat avec FilesPanel
  // Pré-remplis avec un mini mock pour ws-sc (mock workspace) jusqu'à Vague 2
  fileTree: MOCK_FILE_TREE,
  rootFiles: MOCK_ROOT_FILES,

  // Scoped tree structure — Vague 2 le peuplera via loadRoot
  treeByScope: {
    [INITIAL_SCOPE]: makeScopeRootNode(INITIAL_SCOPE),
  },
  loadingPaths: {},

  gitStatusByScope: {},

  refreshGitStatus: async (sk) => {
    const state = get();
    const ws = workspaceForScope(state.workspaces, sk);
    if (!ws) return;

    try {
      const provider = ws.source.kind === "mock"
        ? await (async () => {
            const { MockProvider } = await import("@/lib/fs/mock");
            return new MockProvider(ws.name, MOCK_PROVIDER_TREE);
          })()
        : await providerFor(ws.source, ws.name);

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
      const source = ws.source.kind === "mock"
        ? { kind: "mock" as const, id: ws.source.id }
        : ws.source;
      const provider = ws.source.kind === "mock"
        ? await (async () => {
            const { MockProvider } = await import("@/lib/fs/mock");
            return new MockProvider(ws.name, MOCK_PROVIDER_TREE);
          })()
        : await providerFor(source, ws.name);

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
    if (path.includes("/")) return; // FilesPanel n'affiche que 2 niveaux — skip deep

    const ws = workspaceForScope(state.workspaces, sk);
    if (!ws) return;

    set((s) => ({
      loadingPaths: {
        ...s.loadingPaths,
        [sk]: { ...s.loadingPaths[sk], [path]: true },
      },
    }));

    try {
      const provider = ws.source.kind === "mock"
        ? await (async () => {
            const { MockProvider } = await import("@/lib/fs/mock");
            return new MockProvider(ws.name, MOCK_PROVIDER_TREE);
          })()
        : await providerFor(ws.source, ws.name);

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
      const provider = ws.source.kind === "mock"
        ? await (async () => {
            const { MockProvider } = await import("@/lib/fs/mock");
            return new MockProvider(ws.name, MOCK_PROVIDER_TREE);
          })()
        : await providerFor(ws.source, ws.name);

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
      const provider = ws.source.kind === "mock"
        ? await (async () => {
            const { MockProvider } = await import("@/lib/fs/mock");
            return new MockProvider(ws.name, MOCK_PROVIDER_TREE);
          })()
        : await providerFor(ws.source, ws.name);

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
    const ws = get().workspaces.find((w) => w.branches.some((b) => b.id === branchId));
    return ws?.id;
  },

  setActiveWorkspace: (id) => {
    set((s) => {
      const ws = s.workspaces.find((w) => w.id === id);
      if (!ws) return s;
      const currentBranchInWs = ws.branches.some((b) => b.id === s.activeBranchId);
      const nextBranchId = currentBranchInWs
        ? s.activeBranchId
        : (ws.branches[0]?.id ?? s.activeBranchId);
      const key = scopeKey(id, nextBranchId);
      const nextWorktreeId =
        s.activeWorktreeIdByScope[key] ??
        getDefaultWorktreeId(s.worktreesByWorkspaceId, id, nextBranchId);
      const isMock = ws.source.kind === "mock";
      return {
        activeWorkspaceId: id,
        activeBranchId: nextBranchId,
        activeWorktreeIdByScope: nextWorktreeId
          ? { ...s.activeWorktreeIdByScope, [key]: nextWorktreeId }
          : s.activeWorktreeIdByScope,
        // Fallback mock data pour les workspaces mock, vide sinon (Vague 2 le remplira)
        fileTree: isMock ? MOCK_FILE_TREE : {},
        rootFiles: isMock ? MOCK_ROOT_FILES : [],
        fileTreeLoading: !isMock,
        treeByScope: s.treeByScope[key]
          ? s.treeByScope
          : { ...s.treeByScope, [key]: makeScopeRootNode(key) },
      };
    });
    // Déclencher loadRoot (stub pour l'instant, sera connecté en Vague 2)
    void get().loadRoot(scopeKey(id, get().activeBranchId));
  },

  setActiveBranch: (id) => {
    set((s) => {
      const wsId =
        s.workspaces.find((w) => w.branches.some((b) => b.id === id))?.id ?? s.activeWorkspaceId;
      const key = scopeKey(wsId, id);
      const nextWorktreeId =
        s.activeWorktreeIdByScope[key] ?? getDefaultWorktreeId(s.worktreesByWorkspaceId, wsId, id);
      const isMock = isMockWorkspace(s.workspaces, wsId);
      return {
        activeBranchId: id,
        activeWorkspaceId: wsId,
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

  toggleFolder: (name) =>
    set((s) => {
      const key = scopeKey(s.activeWorkspaceId, s.activeBranchId);
      const current = s.expandedFoldersByScope[key] ?? {};
      return {
        expandedFoldersByScope: {
          ...s.expandedFoldersByScope,
          [key]: { ...current, [name]: !current[name] },
        },
      };
    }),

  toggleFiles: () => set((s) => ({ showFiles: !s.showFiles })),
  toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),
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

  sendMessage: (content) =>
    set((s) => {
      const key = scopeKey(s.activeWorkspaceId, s.activeBranchId);
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
      const prev = s.messagesByScope[key] ?? [];
      return {
        messagesByScope: { ...s.messagesByScope, [key]: [...prev, userMsg, assistantMsg] },
      };
    }),

  addBranch: (workspaceId, name) =>
    set((s) => {
      const branchId = crypto.randomUUID();
      const worktreeId = crypto.randomUUID();
      const key = scopeKey(workspaceId, branchId);
      return {
        workspaces: s.workspaces.map((w) =>
          w.id === workspaceId
            ? {
                ...w,
                branches: [
                  ...w.branches,
                  {
                    id: branchId,
                    name,
                    age: "just now",
                    status: "none",
                  },
                ],
              }
            : w,
        ),
        tasksByBranchId: { ...s.tasksByBranchId, [branchId]: [] },
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
    set((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        branches: w.branches.map((b) => (b.id === branchId ? { ...b, starred: !b.starred } : b)),
      })),
    })),

  addWorkspace: (name, source) =>
    set((s) => {
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
      return {
        workspaces: [
          ...s.workspaces,
          {
            id,
            letter: name.charAt(0).toUpperCase() || "W",
            name,
            color,
            source: effectiveSource,
            branches: [
              { id: branchId, name: "main", age: "just now", starred: true, status: "none" },
            ],
          },
        ],
        tasksByBranchId: { ...s.tasksByBranchId, [branchId]: [] },
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
      };
    }),

  addTask: (branchId, title) =>
    set((s) => ({
      tasksByBranchId: {
        ...s.tasksByBranchId,
        [branchId]: [
          ...(s.tasksByBranchId[branchId] ?? []),
          {
            id: crypto.randomUUID(),
            branchId,
            title,
            status: "todo",
            assignee: "Codex",
            updatedAt: "just now",
          },
        ],
      },
    })),

  cycleTaskStatus: (branchId, taskId) =>
    set((s) => {
      const nextStatus: Record<TaskStatus, TaskStatus> = {
        todo: "in_progress",
        in_progress: "blocked",
        blocked: "done",
        done: "todo",
      };
      return {
        tasksByBranchId: {
          ...s.tasksByBranchId,
          [branchId]: (s.tasksByBranchId[branchId] ?? []).map((task) =>
            task.id === taskId
              ? { ...task, status: nextStatus[task.status], updatedAt: "just now" }
              : task,
          ),
        },
      };
    }),

  setTaskStatus: (branchId, taskId, status) =>
    set((s) => ({
      tasksByBranchId: {
        ...s.tasksByBranchId,
        [branchId]: (s.tasksByBranchId[branchId] ?? []).map((task) =>
          task.id === taskId ? { ...task, status, updatedAt: "just now" } : task,
        ),
      },
    })),

  addWorktree: (workspaceId, branchId, name) =>
    set((s) => {
      const worktreeId = crypto.randomUUID();
      const branchName =
        s.workspaces.find((w) => w.id === workspaceId)?.branches.find((b) => b.id === branchId)
          ?.name ?? "branch";
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
      return {
        sessionsByWorkspaceId: nextSessions,
        activeSessionIdByWorkspaceId: nextActive,
      };
    }),

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
        const provider = ws.source.kind === "mock"
          ? await (async () => {
              const { MockProvider } = await import("@/lib/fs/mock");
              return new MockProvider(ws.name, MOCK_PROVIDER_TREE);
            })()
          : await providerFor(ws.source, ws.name);

        const text = await provider.readFile(path);

        set((s) => {
          const sk = scopeKey(s.activeWorkspaceId, s.activeBranchId);
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
      const provider = ws.source.kind === "mock"
        ? await (async () => {
            const { MockProvider } = await import("@/lib/fs/mock");
            return new MockProvider(ws.name, MOCK_PROVIDER_TREE);
          })()
        : await providerFor(ws.source, ws.name);

      await provider.writeFile(tab.path, tab.content);

      set((s) => {
        const f = s.openFilesByScope[key] ?? [];
        return {
          openFilesByScope: {
            ...s.openFilesByScope,
            [key]: f.map((t) =>
              t.id === activeId ? { ...t, isDirty: false } : t,
            ),
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
          [key]: files.map((f) =>
            f.id === tabId ? { ...f, content, isDirty: true } : f,
          ),
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
}));

// Derived-scope hooks — read current scope's slices cleanly.
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
  const key = useCurrentScopeKey();
  return useIDE((s) => s.messagesByScope[key] ?? EMPTY_MESSAGES);
}

export const TOKEN_CONTEXT_MAX = 200_000;

export function useTokenEstimate(): { used: number; max: number } {
  const messages = useCurrentMessages();
  return useMemo(() => {
    const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return { used: Math.round(chars / 4), max: TOKEN_CONTEXT_MAX };
  }, [messages]);
}

export function useCurrentTasks(): BranchTask[] {
  const branchId = useIDE((s) => s.activeBranchId);
  return useIDE((s) => s.tasksByBranchId[branchId] ?? EMPTY_TASKS);
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

const EMPTY_FILES: FileTab[] = [];
const EMPTY_FOLDERS: Record<string, boolean> = {};
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_TASKS: BranchTask[] = [];
const EMPTY_WORKTREES: Worktree[] = [];

export function useCurrentTree(): TreeNode | undefined {
  const key = useCurrentScopeKey();
  return useIDE((s) => s.treeByScope[key]);
}

export const EMPTY_GIT_STATUS: GitStatusMap = new Map();

export function useCurrentGitStatus(): GitStatusMap {
  const key = useCurrentScopeKey();
  return useIDE((s) => s.gitStatusByScope[key] ?? EMPTY_GIT_STATUS);
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
