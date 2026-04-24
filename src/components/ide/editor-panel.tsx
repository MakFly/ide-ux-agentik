import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIDE, useCurrentOpenFiles, useCurrentActiveTab, type FileTab, type TabId } from "@/store/ide";
import { CodeEditor } from "@/components/ide/code-editor";
import { FileTypeIcon } from "@/components/ide/file-icon";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function EditorPanel() {
  const openFiles = useCurrentOpenFiles();
  const activeTab = useCurrentActiveTab();
  const setActiveTab = useIDE((s) => s.setActiveTab);
  const closeFile = useIDE((s) => s.closeFile);
  const previewMode = useIDE((s) => s.previewMode);

  if (openFiles.length === 0) return null;

  const activeFile = (openFiles.find((f) => f.id === activeTab) ?? openFiles[0]) as FileTab;

  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="scrollbar-none flex items-center overflow-x-auto scroll-smooth snap-x snap-mandatory border-b border-border">
        {openFiles.map((file) => {
          const active = file.id === activeFile.id;
          const basename = file.path.split("/").pop() ?? file.path;
          return (
            <div
              key={file.id}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeFile(file.id);
                }
              }}
              className={cn(
                "group flex shrink-0 snap-start items-center gap-1.5 border-r border-border px-3 py-1.5 text-[12px]",
                active ? "bg-background text-foreground" : "bg-sidebar/40 text-muted-foreground",
              )}
            >
              <button
                onClick={() => setActiveTab(file.id as TabId)}
                className="flex items-center gap-1.5 font-mono"
                title={`${file.path} · middle-click to close`}
              >
                <FileTypeIcon name={basename} />
                <span>{basename}</span>
                {file.isDirty && <span className="text-status-warn">•</span>}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.id);
                }}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                title="Close file"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

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
    </aside>
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-code-bg/40 px-6 py-2 font-mono text-[11.5px] text-muted-foreground">
        <span>{path}</span>
        {isDirty && !loading && content !== null && (
          <span className="text-status-warn" title="Unsaved changes">
            •
          </span>
        )}
        {!isDirty && !loading && content !== null && !isBinary && (
          <span className="text-[10px] text-status-add/70" title="Saved">
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
