import { GitBranch, Terminal } from "lucide-react";

export function StatusBar() {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-titlebar px-3 text-[11.5px] text-muted-foreground">
      <div />
      <div className="flex items-center gap-1.5">
        <GitBranch className="h-3 w-3" />
        <span className="font-mono">master</span>
      </div>
      <div className="flex items-center gap-3">
        <GitBranch className="h-3.5 w-3.5" />
        <Terminal className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}
