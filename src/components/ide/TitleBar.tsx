import { ChevronLeft, ChevronRight, ExternalLink, Wand2, Play, MoreHorizontal, PanelRight, ChevronDown } from "lucide-react";

export function TitleBar() {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-titlebar px-3 select-none">
      {/* Traffic lights */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 pr-2">
          <span className="h-3 w-3 rounded-full bg-[oklch(0.65_0.20_25)]" />
          <span className="h-3 w-3 rounded-full bg-[oklch(0.78_0.16_75)]" />
          <span className="h-3 w-3 rounded-full bg-[oklch(0.72_0.18_145)]" />
        </div>
        <button className="rounded p-1 text-muted-foreground hover:bg-accent">
          <PanelRight className="h-4 w-4 rotate-180" />
        </button>
        <div className="flex items-center gap-0.5 ml-1">
          <button className="rounded p-1 text-muted-foreground hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="rounded p-1 text-muted-foreground hover:bg-accent">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent">
          <ExternalLink className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent">
          <Wand2 className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-primary hover:bg-accent">
          <Play className="h-4 w-4 fill-current" />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-muted-foreground hover:bg-accent">
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
