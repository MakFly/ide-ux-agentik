import { ChevronLeft, ChevronRight, ExternalLink, Wand2, Play, MoreHorizontal, PanelRight, ChevronDown, PanelLeft } from "lucide-react";
import { useIDE } from "@/store/ide";
import { toast } from "sonner";

export function TitleBar() {
  const { toggleSidebar, toggleFiles, workspaces, activeWorkspaceId } = useIDE();
  const ws = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-titlebar px-3 select-none">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 pr-2">
          <button
            onClick={() => toast("Close not available in mock")}
            className="h-3 w-3 rounded-full bg-[oklch(0.65_0.20_25)] hover:brightness-110"
          />
          <button
            onClick={() => toast("Minimize not available in mock")}
            className="h-3 w-3 rounded-full bg-[oklch(0.78_0.16_75)] hover:brightness-110"
          />
          <button
            onClick={() => toast("Maximize not available in mock")}
            className="h-3 w-3 rounded-full bg-[oklch(0.72_0.18_145)] hover:brightness-110"
          />
        </div>
        <button
          onClick={toggleSidebar}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-0.5 ml-1">
          <button
            onClick={() => window.history.back()}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.history.forward()}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => toast(`Workspace: ${ws?.name ?? "—"}`)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span className="font-mono">{ws?.name}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => window.open("https://github.com", "_blank")}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Open externally"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          onClick={() => toast("Magic actions ✨")}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Wand2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => toast.success("Run started")}
          className="rounded p-1.5 text-primary hover:bg-accent"
        >
          <Play className="h-4 w-4 fill-current" />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => toast("More options")}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <button
          onClick={toggleFiles}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Toggle files panel"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
