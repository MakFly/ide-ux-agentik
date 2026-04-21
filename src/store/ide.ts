import { create } from "zustand";

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

export type Workspace = {
  id: string;
  letter: string;
  name: string;
  color: string;
  branches: Branch[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
};

export type TabId = "codex" | "claude" | "opencode" | "gemini" | "overview" | "audit";

type State = {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeBranchId: string;
  activeTab: TabId;
  messagesByBranch: Record<string, ChatMessage[]>;
  expandedFolders: Record<string, boolean>;
  showFiles: boolean;
  showSidebar: boolean;
  filesTab: "files" | "changes" | "checks";
  thinking: boolean;

  setActiveWorkspace: (id: string) => void;
  setActiveBranch: (id: string) => void;
  setActiveTab: (id: TabId) => void;
  toggleFolder: (name: string) => void;
  toggleFiles: () => void;
  toggleSidebar: () => void;
  setFilesTab: (t: "files" | "changes" | "checks") => void;
  toggleThinking: () => void;
  sendMessage: (content: string) => void;
  addBranch: (workspaceId: string, name: string) => void;
  toggleStar: (branchId: string) => void;
  addWorkspace: (name: string) => void;
};

const initialWorkspaces: Workspace[] = [
  {
    id: "ws-sc",
    letter: "S",
    name: "superconductor",
    color: "oklch(0.45 0.18 270)",
    branches: [
      { id: "b1", name: "master", age: "14h ago", starred: true, status: "none" },
      { id: "b2", name: "feat/meta-chat", age: "5h ago", added: 5518, removed: 169, status: "loading" },
      { id: "b3", name: "fix/chat-feedback-notifications", age: "3m ago", added: 178, removed: 13, status: "none" },
      { id: "b4", name: "fix/diff-view-text-selection", age: "3m ago", added: 86, removed: 18, status: "none" },
      { id: "b5", name: "fix/right-sidebar-vertical-line", age: "58m ago", status: "warn" },
      { id: "b6", name: "fix/workspace-sidebar-state", age: "2h ago", added: 109, removed: 23, status: "warn" },
      { id: "b7", name: "fix/git-diff-highlight-accuracy", age: "2h ago", added: 447, removed: 57, status: "active" },
      { id: "b8", name: "fix/tab-title-overwrite", age: "14m ago", added: 59, removed: 5, status: "warn" },
      { id: "b9", name: "feat/git-action-dropdown-menu", age: "14h ago", added: 1136, removed: 184, status: "none" },
      { id: "b10", name: "fix/shared-context-isolation", age: "3h ago", added: 90, removed: 20, status: "active" },
      { id: "b11", name: "fix/stear-chat-timeline", age: "14h ago", added: 899, removed: 129, status: "none" },
      { id: "b12", name: "feat/scrollable-tab-bar", age: "6d ago", added: 147, removed: 86, status: "none" },
      { id: "b13", name: "feat/shared-context-sorting-dnd", age: "1w ago", added: 2163, removed: 21, status: "none" },
    ],
  },
  {
    id: "ws-landing",
    letter: "L",
    name: "landing",
    color: "oklch(0.55 0.13 60)",
    branches: [
      { id: "l1", name: "main", age: "4w ago", starred: true, status: "none" },
      { id: "l2", name: "feat/marketing-landing-page", age: "1d ago", added: 533, removed: 26, status: "none" },
    ],
  },
];

const seedMessage: ChatMessage = {
  id: "seed",
  role: "user",
  content: "explain this codebase",
};

export const useIDE = create<State>((set) => ({
  workspaces: initialWorkspaces,
  activeWorkspaceId: "ws-sc",
  activeBranchId: "b1",
  activeTab: "overview",
  messagesByBranch: { b1: [seedMessage] },
  expandedFolders: { crates: true },
  showFiles: true,
  showSidebar: true,
  filesTab: "files",
  thinking: true,

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
  setActiveBranch: (id) =>
    set((s) => ({
      activeBranchId: id,
      messagesByBranch: s.messagesByBranch[id]
        ? s.messagesByBranch
        : { ...s.messagesByBranch, [id]: [] },
    })),
  setActiveTab: (id) => set({ activeTab: id }),
  toggleFolder: (name) =>
    set((s) => ({ expandedFolders: { ...s.expandedFolders, [name]: !s.expandedFolders[name] } })),
  toggleFiles: () => set((s) => ({ showFiles: !s.showFiles })),
  toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),
  setFilesTab: (t) => set({ filesTab: t }),
  toggleThinking: () => set((s) => ({ thinking: !s.thinking })),

  sendMessage: (content) =>
    set((s) => {
      const id = s.activeBranchId;
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
      const prev = s.messagesByBranch[id] ?? [];
      return {
        messagesByBranch: { ...s.messagesByBranch, [id]: [...prev, userMsg, assistantMsg] },
      };
    }),

  addBranch: (workspaceId, name) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? {
              ...w,
              branches: [
                ...w.branches,
                {
                  id: crypto.randomUUID(),
                  name,
                  age: "just now",
                  status: "none",
                },
              ],
            }
          : w,
      ),
    })),

  toggleStar: (branchId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        branches: w.branches.map((b) =>
          b.id === branchId ? { ...b, starred: !b.starred } : b,
        ),
      })),
    })),

  addWorkspace: (name) =>
    set((s) => ({
      workspaces: [
        ...s.workspaces,
        {
          id: crypto.randomUUID(),
          letter: name.charAt(0).toUpperCase() || "W",
          name,
          color: "oklch(0.50 0.15 200)",
          branches: [
            { id: crypto.randomUUID(), name: "main", age: "just now", starred: true, status: "none" },
          ],
        },
      ],
    })),
}));

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
