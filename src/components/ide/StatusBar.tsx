import { GitBranch, Terminal } from "lucide-react";
import { useIDE } from "@/store/ide";
import { toast } from "sonner";

export function StatusBar() {
  const { workspaces, activeBranchId } = useIDE();
  const branch = workspaces.flatMap((w) => w.branches).find((b) => b.id === activeBranchId);

  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-titlebar px-3 text-[11.5px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>Ready</span>
      </div>
      <div className="flex items-center gap-1.5">
        <GitBranch className="h-3 w-3" />
        <span className="font-mono">{branch?.name ?? "—"}</span>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => toast("Branch info")} className="hover:text-foreground">
          <GitBranch className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => toast("Toggle terminal")} className="hover:text-foreground">
          <Terminal className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
