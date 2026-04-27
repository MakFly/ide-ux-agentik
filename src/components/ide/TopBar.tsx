import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  HelpCircle,
  Keyboard,
  Link2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useIDE } from "@/store/ide";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GitActions } from "@/components/ide/topbar/git-actions";
import { SkillsTrigger } from "@/components/ide/skills-trigger";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { AddWorkspaceDialog } from "@/components/ide/add-workspace-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function TopBar() {
  const { toggleSidebar, toggleFiles, workspaces, activeWorkspaceId, setActiveWorkspace } =
    useIDE();
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const branchesByWorkspaceId = useIDE((s) => s.branchesByWorkspaceId);
  const activeBranchIdByWorkspaceId = useIDE((s) => s.activeBranchIdByWorkspaceId);
  const hasWorkspace = !!activeWorkspaceId;
  const navigate = useNavigate();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    setIsMac(detectMac());
  }, []);

  // ⌘K / Ctrl+K — toggle command palette globally
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const branchNameFor = (workspaceId: string): string | undefined => {
    const list = branchesByWorkspaceId[workspaceId];
    if (!list || list.length === 0) return undefined;
    const id = activeBranchIdByWorkspaceId[workspaceId];
    return list.find((b) => b.id === id)?.name ?? list[0]?.name;
  };

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
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="group flex h-8 w-[320px] items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {activeWorkspace ? (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-semibold text-white"
                  style={{ background: activeWorkspace.color }}
                >
                  {activeWorkspace.letter}
                </span>
                <span className="truncate font-mono text-[12px] text-foreground/80">
                  {activeWorkspace.name}
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span className="truncate text-[11px]">Search workspaces…</span>
              </span>
            ) : (
              <span className="flex-1 truncate text-left">Search workspaces, commands…</span>
            )}
            <kbd
              aria-hidden="true"
              className="hidden sm:inline-flex shrink-0 items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
            >
              <span>{isMac ? "⌘" : "Ctrl"}</span>
              <span>K</span>
            </kbd>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <SkillsTrigger />
          <div className="mx-1 h-4 w-px bg-border/60" />
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
              <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                <Search className="h-3.5 w-3.5" />
                Command palette
                <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  toast("Shortcuts", {
                    description:
                      "⌘B sidebar · ⌘J files · ⌘` terminal · ⌘K command palette",
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

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Search workspaces, run actions…" />
        <CommandList className="max-h-[60vh] sm:max-h-[420px]">
          <CommandEmpty>No results found.</CommandEmpty>

          {workspaces.length > 0 ? (
            <CommandGroup heading="Workspaces">
              {workspaces.map((workspace) => {
                const branchName = branchNameFor(workspace.id);
                const isActive = workspace.id === activeWorkspaceId;
                return (
                  <CommandItem
                    key={workspace.id}
                    value={`workspace ${workspace.name} ${workspace.letter} ${branchName ?? ""} ${workspace.id}`}
                    onSelect={() => {
                      setActiveWorkspace(workspace.id);
                      setPaletteOpen(false);
                    }}
                    className="gap-2"
                  >
                    <span
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-semibold text-white"
                      style={{ background: workspace.color }}
                    >
                      {workspace.letter}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {workspace.name}
                    </span>
                    {branchName ? (
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
                        <GitBranch className="h-3 w-3" />
                        <span className="max-w-[100px] truncate">{branchName}</span>
                      </span>
                    ) : null}
                    {isActive ? (
                      <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                        active
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          <CommandSeparator />

          <CommandGroup heading="Actions">
            <CommandItem
              value="action-new-workspace"
              onSelect={() => {
                setPaletteOpen(false);
                setAddWorkspaceOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-3.5 w-3.5" />
              New workspace…
            </CommandItem>
            <CommandItem
              value="action-copy-link"
              onSelect={() => {
                setPaletteOpen(false);
                void copyWorkspaceLink();
              }}
              className="gap-2"
            >
              <Link2 className="h-3.5 w-3.5" />
              Copy workspace link
            </CommandItem>
            <CommandItem
              value="action-reload"
              onSelect={() => {
                setPaletteOpen(false);
                window.location.reload();
              }}
              className="gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload window
            </CommandItem>
            <CommandItem
              value="action-docs"
              onSelect={() => {
                setPaletteOpen(false);
                void navigate({ to: "/docs" });
              }}
              className="gap-2"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Documentation
            </CommandItem>
          </CommandGroup>
        </CommandList>

        <div className="flex items-center justify-end border-t px-3 py-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            ↑↓ navigate · ↵ select · esc close
          </span>
        </div>
      </CommandDialog>

      <AddWorkspaceDialog open={addWorkspaceOpen} onOpenChange={setAddWorkspaceOpen} />
    </TooltipProvider>
  );
}
