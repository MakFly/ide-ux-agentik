import { ChevronRight, ChevronDown, Folder, FolderOpen, File as FileIcon, Eye, GitBranch, Terminal as TermIcon } from "lucide-react";
import { useIDE } from "@/store/ide";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const folders: Record<string, string[]> = {
  ".agent-temp-edits": ["session.json"],
  ".cargo": ["config.toml"],
  ".claude": ["settings.json", "tools.json"],
  ".codex": ["index.db"],
  ".config": ["nextest.toml"],
  ".githooks": ["pre-commit"],
  ".github": ["workflows/ci.yml", "ISSUE_TEMPLATE.md"],
  ".perf-runs": ["2024-11-12.json"],
  ".sc": ["state.bin"],
  ".serena": ["memory.json"],
  ".worktrees": ["master/", "feat-meta-chat/"],
  assets: ["icon.icns", "logo.svg"],
  crates: ["sc_app/", "sc_git/", "sc_diff/", "sc_worktree/", "sc_db/", "sc_terminal_view/"],
  docs: ["ARCHITECTURE.md", "CONTRIBUTING.md"],
  scripts: ["release.sh", "bench.sh"],
  target: ["debug/", "release/"],
  tmp: [],
};

const rootFiles = [
  ".DS_Store", ".env", ".env.example", ".gitignore", ".mcp.json",
  "AGENTS.md", "Cargo.lock", "Cargo.toml", "CLAUDE.md", "cliff.toml",
  "Justfile", "README.md", "rust-toolchain.toml", "rustfmt.toml",
];

export function FilesPanel() {
  const { showFiles, expandedFolders, toggleFolder, filesTab, setFilesTab, workspaces, activeBranchId } = useIDE();

  if (!showFiles) return null;

  const branch = workspaces.flatMap((w) => w.branches).find((b) => b.id === activeBranchId);
  const changesCount = (branch?.added ?? 0) + (branch?.removed ?? 0) > 0 ? 1 : 0;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-sidebar">
      <div className="flex items-center gap-5 border-b border-border px-4 py-2.5">
        {(["files", "changes", "checks"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilesTab(t)}
            className={cn(
              "text-[13px] capitalize transition-colors",
              filesTab === t ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {t === "changes" && (
              <span className="ml-1 text-muted-foreground/60">{changesCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {filesTab === "files" && (
          <>
            {Object.entries(folders).map(([name, children]) => {
              const open = !!expandedFolders[name];
              return (
                <div key={name}>
                  <div
                    onClick={() => toggleFolder(name)}
                    className="flex items-center gap-1.5 px-3 py-[3px] text-[13px] text-foreground hover:bg-accent/40 cursor-pointer"
                  >
                    {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    {open ? <FolderOpen className="h-3.5 w-3.5 text-syntax-fn" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="font-mono">{name}</span>
                  </div>
                  {open && children.map((c) => (
                    <div
                      key={c}
                      onClick={() => toast(`Opened ${name}/${c}`)}
                      className="flex items-center gap-1.5 py-[3px] pl-[36px] pr-3 text-[12.5px] text-muted-foreground hover:bg-accent/40 hover:text-foreground cursor-pointer"
                    >
                      {c.endsWith("/") ? (
                        <Folder className="h-3.5 w-3.5" />
                      ) : (
                        <FileIcon className="h-3.5 w-3.5" />
                      )}
                      <span className="font-mono">{c}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {rootFiles.map((f) => (
              <div
                key={f}
                onClick={() => toast(`Opened ${f}`)}
                className="flex items-center gap-1.5 px-3 py-[3px] pl-[22px] text-[13px] text-muted-foreground hover:bg-accent/40 hover:text-foreground cursor-pointer"
              >
                <FileIcon className="h-3.5 w-3.5" />
                <span className="font-mono">{f}</span>
              </div>
            ))}
          </>
        )}

        {filesTab === "changes" && (
          <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
            {branch && (branch.added || branch.removed) ? (
              <div className="space-y-2">
                <div className="font-mono text-foreground">{branch.name}</div>
                <div className="font-mono">
                  <span className="text-status-add">+{branch.added ?? 0}</span>{" "}
                  <span className="text-status-del">-{branch.removed ?? 0}</span>
                </div>
                <div className="rounded border border-border bg-code-bg p-2 font-mono text-[11.5px]">
                  Modified: <span className="text-foreground">crates/sc_app/src/main.rs</span>
                </div>
              </div>
            ) : (
              <div>No changes on this branch.</div>
            )}
          </div>
        )}

        {filesTab === "checks" && (
          <div className="space-y-2 px-4 py-3 text-[12.5px]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-status-add" />
              <span className="text-foreground">cargo check</span>
              <span className="ml-auto text-muted-foreground">passed</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-status-add" />
              <span className="text-foreground">cargo test</span>
              <span className="ml-auto text-muted-foreground">142 ok</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-status-warn" />
              <span className="text-foreground">clippy</span>
              <span className="ml-auto text-muted-foreground">3 warns</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <button onClick={() => toast("Preview mode")} className="text-muted-foreground hover:text-foreground">
          <Eye className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => toast("Git actions")} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <GitBranch className="h-4 w-4" />
          </button>
          <button onClick={() => toast("Open terminal")} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <TermIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
