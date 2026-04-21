import { ChevronDown, Plus, Star, GitBranch, Settings, FolderPlus, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Branch = {
  name: string;
  age: string;
  added?: number;
  removed?: number;
  status?: "active" | "warn" | "loading" | "dot" | "none";
  starred?: boolean;
  highlighted?: boolean;
};

const superconductorBranches: Branch[] = [
  { name: "master", age: "14h ago", starred: true, status: "none" },
  { name: "feat/meta-chat", age: "5h ago", added: 5518, removed: 169, status: "loading" },
  { name: "fix/chat-feedback-notifications", age: "3m ago", added: 178, removed: 13, status: "none" },
  { name: "fix/diff-view-text-selection", age: "3m ago", added: 86, removed: 18, status: "none" },
  { name: "fix/right-sidebar-vertical-line", age: "58m ago", added: 0, removed: 0, status: "warn" },
  { name: "fix/workspace-sidebar-state", age: "2h ago", added: 109, removed: 23, status: "warn" },
  { name: "fix/git-diff-highlight-accuracy", age: "2h ago", added: 447, removed: 57, status: "active" },
  { name: "fix/tab-title-overwrite", age: "14m ago", added: 59, removed: 5, status: "warn" },
  { name: "feat/git-action-dropdown-menu", age: "14h ago", added: 1136, removed: 184, status: "none", highlighted: true },
  { name: "fix/shared-context-isolation", age: "3h ago", added: 90, removed: 20, status: "active" },
  { name: "fix/stear-chat-timeline", age: "14h ago", added: 899, removed: 129, status: "none" },
  { name: "feat/scrollable-tab-bar", age: "6d ago", added: 147, removed: 86, status: "none" },
  { name: "feat/shared-context-sorting-dnd", age: "1w ago", added: 2163, removed: 21, status: "none" },
];

const landingBranches: Branch[] = [
  { name: "main", age: "4w ago", starred: true, status: "none" },
  { name: "feat/marketing-landing-page", age: "1d ago", added: 533, removed: 26, status: "none" },
];

function StatusDot({ status }: { status?: Branch["status"] }) {
  if (!status || status === "none") {
    return <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />;
  }
  if (status === "loading") {
    return <span className="block h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/60" />;
  }
  if (status === "warn") {
    return <span className="block h-2 w-2 shrink-0 rounded-full bg-status-warn" />;
  }
  if (status === "active") {
    return <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-status-warn/15 text-[9px] font-bold text-status-warn">?</span>;
  }
  return <span className="block h-2 w-2 shrink-0 rounded-full bg-primary" />;
}

function BranchRow({ branch, active }: { branch: Branch; active?: boolean }) {
  return (
    <div
      className={cn(
        "group mx-1.5 flex flex-col gap-0.5 rounded-md px-2 py-1.5 cursor-pointer",
        active && "bg-branch-active",
        !active && "hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <StatusDot status={branch.status} />
        <span
          className={cn(
            "truncate font-mono",
            branch.highlighted ? "text-primary" : "text-foreground",
          )}
        >
          {branch.name}
        </span>
        {branch.starred && <Star className="h-3 w-3 fill-status-warn text-status-warn" />}
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
          {!!branch.added && <span className="text-status-add">+{branch.added}</span>}
          {!!branch.removed && <span className="text-status-del">-{branch.removed}</span>}
        </div>
      </div>
      <div className="pl-5 text-[11px] text-muted-foreground">{branch.age}</div>
    </div>
  );
}

function WorkspaceHeader({ letter, name, color }: { letter: string; name: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div
        className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold text-white"
        style={{ background: color }}
      >
        {letter}
      </div>
      <span className="text-[13px] font-medium text-foreground">{name}</span>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      <button className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="px-3 pt-3 pb-1">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
          SUPERCONDUCTOR
        </span>
      </div>

      <WorkspaceHeader letter="S" name="superconductor" color="oklch(0.45 0.18 270)" />

      <div className="flex-1 overflow-y-auto py-1">
        <BranchRow branch={superconductorBranches[0]} active />
        {superconductorBranches.slice(1).map((b) => (
          <BranchRow key={b.name} branch={b} />
        ))}

        <div className="mt-2">
          <WorkspaceHeader letter="L" name="landing" color="oklch(0.55 0.13 60)" />
          {landingBranches.map((b) => (
            <BranchRow key={b.name} branch={b} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <Settings className="h-4 w-4" />
        </button>
        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <FolderPlus className="h-4 w-4" />
        </button>
        <div className="mx-auto flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          <Plus className="ml-1 h-3 w-3 text-muted-foreground" />
        </div>
        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
