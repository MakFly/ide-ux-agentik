import {
  ChevronRight,
  ChevronDown,
  Eye,
  Terminal as TermIcon,
  FolderPlus,
  FilePlus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { FileTypeIcon } from "@/components/ide/file-icon";
import { useIDE, useCurrentBranches, useCurrentExpandedFolders, useCurrentGitStatus, type ScopeKey, scopeKey } from "@/store/ide";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useState } from "react";
import { PromptDialog } from "@/components/ide/prompt-dialog";
import { BranchDetailsPopover } from "@/components/ide/StatusBar";
import {
  FileTreeSkeleton,
  ChangesSkeleton,
  ChecksSkeleton,
} from "@/components/ide/skeletons/files-panel-skeletons";
import type { GitFileStatus } from "@/lib/git/status";

export function FilesPanel() {
  const showFiles = useIDE((s) => s.showFiles);
  const toggleFolder = useIDE((s) => s.toggleFolder);
  const expandedFolders = useCurrentExpandedFolders();
  const filesTab = useIDE((s) => s.filesTab);
  const setFilesTab = useIDE((s) => s.setFilesTab);
  const workspaces = useIDE((s) => s.workspaces);
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const fileTree = useIDE((s) => s.fileTree);
  const rootFiles = useIDE((s) => s.rootFiles);
  const createFolder = useIDE((s) => s.createFolder);
  const createFile = useIDE((s) => s.createFile);
  const deleteEntry = useIDE((s) => s.deleteEntry);
  const openFile = useIDE((s) => s.openFile);
  const previewMode = useIDE((s) => s.previewMode);
  const togglePreview = useIDE((s) => s.togglePreview);
  const toggleTerminal = useIDE((s) => s.toggleTerminal);
  const showTerminal = useIDE((s) => s.showTerminal);
  const fileTreeLoading = useIDE((s) => s.fileTreeLoading);

  const loadRoot = useIDE((s) => s.loadRoot);
  const refreshGitStatus = useIDE((s) => s.refreshGitStatus);
  const gitStatus = useCurrentGitStatus();
  const currentBranches = useCurrentBranches();

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [fileDialogFor, setFileDialogFor] = useState<string | null | false>(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!showFiles) return null;

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const branch = currentBranches.find((b) => b.id === activeBranchId);
  const changesCount = gitStatus.size > 0 ? gitStatus.size : ((branch?.added ?? 0) + (branch?.removed ?? 0) > 0 ? 1 : 0);

  const activeScopeKey: ScopeKey = scopeKey(activeWorkspaceId, activeBranchId);

  function getFolderStatus(folderName: string): GitFileStatus | null {
    const priority: GitFileStatus[] = ["modified", "added", "deleted", "untracked"];
    let best: GitFileStatus | null = null;
    for (const [path, st] of gitStatus.entries()) {
      if (path.startsWith(folderName + "/")) {
        const idx = priority.indexOf(st);
        const bestIdx = best ? priority.indexOf(best) : Infinity;
        if (idx < bestIdx) best = st;
      }
    }
    return best;
  }

  function statusBadge(status: GitFileStatus | undefined | null) {
    if (!status || status === "clean") return null;
    const letter = status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : "?";
    return (
      <span className={cn(
        "mr-1 font-mono text-[10px] uppercase",
        status === "modified" && "text-status-warn",
        status === "added" && "text-status-add",
        status === "deleted" && "text-status-del",
        status === "untracked" && "text-muted-foreground",
      )}>
        {letter}
      </span>
    );
  }

  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-sidebar shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-5">
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
              {t === "changes" && <span className="ml-1 text-muted-foreground/60">{changesCount}</span>}
            </button>
          ))}
        </div>
        {filesTab === "files" && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFileDialogFor(null)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New file at root"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setFolderDialogOpen(true)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New folder"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={async () => {
                setRefreshing(true);
                try {
                  await loadRoot(activeScopeKey);
                  await refreshGitStatus(activeScopeKey);
                  toast.success("Refreshed");
                } finally {
                  setRefreshing(false);
                }
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Refresh files & git status"
              disabled={refreshing}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
        )}
      </div>

      <div className="scrollbar-visible flex-1 overflow-y-auto py-1.5">
        {filesTab === "files" && fileTreeLoading && <FileTreeSkeleton />}
        {filesTab === "files" && !fileTreeLoading && (
          <>
            {Object.entries(fileTree).map(([name, children]) => {
              const open = !!expandedFolders[name];
              const folderSt = getFolderStatus(name);
              return (
                <div key={name}>
                  <div className="group flex items-center">
                    <div
                      onClick={() => toggleFolder(name)}
                      className="flex flex-1 cursor-pointer items-center gap-1.5 px-3 py-[3px] text-[13px] text-foreground hover:bg-accent/40"
                    >
                      {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      <FileTypeIcon name={name} isDir isOpen={open} />
                      <span className="font-mono">{name}</span>
                    </div>
                    <div className="flex items-center gap-0.5 pr-2">
                      <span className="transition-opacity group-hover:opacity-0">{statusBadge(folderSt)}</span>
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setFileDialogFor(name);
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="New file in folder"
                        >
                          <FilePlus className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete folder "${name}"?`)) {
                              deleteEntry(null, name);
                              toast.success(`Folder "${name}" deleted`);
                            }
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                          title="Delete folder"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {open &&
                    children.map((c) => {
                      const subKey = `${name}/${c}`;
                      const isFolder = c.endsWith("/");
                      const subOpen = isFolder && !!expandedFolders[subKey];
                      return (
                      <div key={c} className="group flex items-center">
                        <div
                          onClick={() => {
                            if (isFolder) {
                              toggleFolder(subKey);
                            } else {
                              openFile(`${name}/${c}`);
                            }
                          }}
                          className="flex flex-1 cursor-pointer items-center gap-1.5 py-[3px] pl-[36px] pr-3 text-[12.5px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                        >
                          <FileTypeIcon name={c.replace(/\/$/, "")} isDir={isFolder} isOpen={subOpen} />
                          <span className="font-mono">{c}</span>
                        </div>
                        {isFolder
                          ? statusBadge(getFolderStatus(subKey))
                          : statusBadge(gitStatus.get(`${name}/${c}`))}
                        {!c.endsWith("/") && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteEntry(name, c);
                              toast.success(`Deleted ${name}/${c}`);
                            }}
                            className="mr-2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                            title="Delete file"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      );
                    })}
                </div>
              );
            })}

            {rootFiles.map((f) => (
              <div key={f} className="group flex items-center">
                <div
                  onClick={() => openFile(f)}
                  className="flex flex-1 cursor-pointer items-center gap-1.5 px-3 py-[3px] pl-[22px] text-[13px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  <FileTypeIcon name={f} />
                  <span className="font-mono">{f}</span>
                </div>
                {statusBadge(gitStatus.get(f))}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteEntry(null, f);
                    toast.success(`Deleted ${f}`);
                  }}
                  className="mr-2 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                  title="Delete file"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </>
        )}

        {filesTab === "changes" && fileTreeLoading && <ChangesSkeleton />}
        {filesTab === "changes" && !fileTreeLoading && (
          <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
            {gitStatus.size > 0 ? (
              <div className="space-y-1">
                {Array.from(gitStatus.entries()).map(([path, st]) => (
                  <div
                    key={path}
                    className="flex items-center gap-2 rounded border border-border bg-code-bg px-2 py-1 font-mono text-[11.5px] cursor-pointer hover:bg-accent/40"
                    onClick={() => openFile(path)}
                  >
                    {statusBadge(st)}
                    <span className="text-foreground truncate">{path}</span>
                  </div>
                ))}
              </div>
            ) : branch && (branch.added || branch.removed) ? (
              <div className="space-y-2">
                <div className="font-mono text-foreground">{branch.name}</div>
                <div className="font-mono">
                  <span className="text-status-add">+{branch.added ?? 0}</span>{" "}
                  <span className="text-status-del">-{branch.removed ?? 0}</span>
                </div>
              </div>
            ) : (
              <div>No changes on this branch.</div>
            )}
          </div>
        )}

        {filesTab === "checks" && fileTreeLoading && <ChecksSkeleton />}
        {filesTab === "checks" && !fileTreeLoading && (
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
        <button
          onClick={togglePreview}
          className={cn(
            "rounded p-1 transition-colors",
            previewMode
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          title={previewMode ? "Preview mode: on" : "Preview mode: off"}
        >
          <Eye className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1">
          <BranchDetailsPopover />
          <button
            onClick={toggleTerminal}
            className={cn(
              "rounded p-1 transition-colors",
              showTerminal
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            title={showTerminal ? "Close terminal" : "Open terminal"}
          >
            <TermIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <PromptDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        title="New folder"
        description="Create a new folder at the repository root."
        label="Folder name"
        placeholder="my-folder"
        confirmLabel="Create folder"
        validate={(v) => (fileTree[v] ? "A folder with this name already exists" : undefined)}
        onSubmit={(name) => {
          createFolder(name);
          toast.success(`Folder "${name}" created`);
        }}
      />

      <PromptDialog
        open={fileDialogFor !== false}
        onOpenChange={(o) => !o && setFileDialogFor(false)}
        title={fileDialogFor ? `New file in ${fileDialogFor}` : "New file at root"}
        description="Create a new file in this location."
        label="File name"
        placeholder="example.ts"
        confirmLabel="Create file"
        onSubmit={(name) => {
          const folder = fileDialogFor === null ? null : (fileDialogFor as string);
          createFile(folder, name);
          const path = folder ? `${folder}/${name}` : name;
          toast.success(`File "${path}" created`);
        }}
      />
    </aside>
  );
}
