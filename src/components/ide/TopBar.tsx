import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  PanelRight,
  PanelLeft,
  Link2,
  Keyboard,
  RefreshCw,
  HelpCircle,
} from "lucide-react";
import { useIDE } from "@/store/ide";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GitActions } from "@/components/ide/topbar/git-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "@tanstack/react-router";

export function TopBar() {
  const { toggleSidebar, toggleFiles, workspaces, activeWorkspaceId, setActiveWorkspace } =
    useIDE();
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const hasWorkspace = !!activeWorkspaceId;
  const navigate = useNavigate();

  const copyWorkspaceLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", activeWorkspaceId);
    url.searchParams.set("branch", activeBranchId);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success("Workspace link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  return (
    <TooltipProvider delayDuration={400}>
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-titlebar px-3 select-none">
      <div className="flex items-center gap-2">
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
            aria-label="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.history.forward()}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Forward"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Select value={activeWorkspaceId} onValueChange={setActiveWorkspace}>
          <SelectTrigger className="h-8 w-[220px] border-none bg-transparent px-2 py-1 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground focus:ring-0">
            <SelectValue placeholder="Select workspace" />
          </SelectTrigger>
          <SelectContent align="center">
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold text-white"
                    style={{ background: workspace.color }}
                  >
                    {workspace.letter}
                  </span>
                  <span className="font-mono text-[12px]">{workspace.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        <GitActions disabled={!hasWorkspace} />
        <div className="mx-1 h-4 w-px bg-border/60" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="More"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Workspace
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={copyWorkspaceLink}>
              <Link2 className="h-3.5 w-3.5" />
              Copy workspace link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.location.reload()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Reload window
              <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                toast("Shortcuts", {
                  description:
                    "⌘B sidebar · ⌘J files · ⌘` terminal · ⌘K command (soon)",
                })
              }
            >
              <Keyboard className="h-3.5 w-3.5" />
              Keyboard shortcuts
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/docs" })}>
              <HelpCircle className="h-3.5 w-3.5" />
              Documentation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={toggleFiles}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Toggle files panel"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </header>
    </TooltipProvider>
  );
}
