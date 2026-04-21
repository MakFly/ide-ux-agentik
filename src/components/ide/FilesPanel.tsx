import { ChevronRight, Folder, File as FileIcon, Eye, GitBranch, Terminal as TermIcon } from "lucide-react";

const folders = [
  ".agent-temp-edits", ".cargo", ".claude", ".codex", ".config", ".githooks",
  ".github", ".perf-runs", ".sc", ".serena", ".worktrees", "assets",
  "crates", "docs", "scripts", "target", "tmp",
];

const files = [
  ".DS_Store", ".env", ".env.example", ".gitignore", ".mcp.json",
  "AGENTS.md", "Cargo.lock", "Cargo.toml", "CLAUDE.md", "cliff.toml",
  "Justfile", "README.md", "rust-toolchain.toml", "rustfmt.toml",
];

export function FilesPanel() {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-sidebar">
      <div className="flex items-center gap-5 border-b border-border px-4 py-2.5">
        <button className="text-[13px] font-medium text-foreground">Files</button>
        <button className="text-[13px] text-muted-foreground hover:text-foreground">
          Changes <span className="text-muted-foreground/60">0</span>
        </button>
        <button className="text-[13px] text-muted-foreground hover:text-foreground">Checks</button>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {folders.map((f) => (
          <div
            key={f}
            className="flex items-center gap-1.5 px-3 py-[3px] text-[13px] text-foreground hover:bg-accent/40 cursor-pointer"
          >
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <Folder className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono">{f}</span>
          </div>
        ))}
        {files.map((f) => (
          <div
            key={f}
            className="flex items-center gap-1.5 px-3 py-[3px] pl-[22px] text-[13px] text-muted-foreground hover:bg-accent/40 cursor-pointer"
          >
            <FileIcon className="h-3.5 w-3.5" />
            <span className="font-mono">{f}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <button className="text-muted-foreground hover:text-foreground">
          <Eye className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1">
          <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <GitBranch className="h-4 w-4" />
          </button>
          <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <TermIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
