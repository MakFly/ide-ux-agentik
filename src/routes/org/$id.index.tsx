import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useContext, useState } from "react";
import { z } from "zod";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  FolderPlus,
  GitBranch,
  Globe2,
  KeyRound,
  Monitor,
  Server,
  Settings,
  Sparkles,
} from "lucide-react";
import { IdeShell, type IdeShellSearch } from "@/components/ide/ide-shell";
import { AddWorkspaceForm, type WorkspaceInput } from "@/components/ide/add-workspace-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIDE, type Workspace } from "@/store/ide";
import { OrgContext } from "./$id";

const agentTabSchema = z.enum(["codex", "claude", "opencode", "gemini", "overview", "audit"]);
const fileTabSchema = z.string().regex(/^file:/);
const terminalTabSchema = z.string().regex(/^terminal:/);
const tabSchema = z.union([agentTabSchema, terminalTabSchema, fileTabSchema]);

const searchSchema = z.object({
  workspace: z.string().optional(),
  branch: z.string().optional(),
  tab: tabSchema.optional(),
  // Back-compat: `?task=<id>` opens the owning thread; store writes `?thread=<id>`.
  task: z.string().optional(),
  thread: z.string().optional(),
});

export const Route = createFileRoute("/org/$id/")({
  component: OrgPage,
  validateSearch: searchSchema,
});

function OrgPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/org/$id" });
  const org = useContext(OrgContext);
  const workspaces = useIDE((s) => s.workspaces);
  if (!org) return null;

  const handleNavigate = (nextSearch: Record<string, unknown>) => {
    navigate({
      search: (prev) => {
        const next = { ...(prev as Record<string, unknown>), ...nextSearch };
        for (const key of ["workspace", "branch", "tab", "task", "thread"] as const) {
          if (next[key] === undefined) {
            delete next[key];
          }
        }
        return next;
      },
      replace: true,
    });
  };

  const requestedWorkspace = search.workspace
    ? (workspaces.find((workspace) => workspace.id === search.workspace) ?? null)
    : null;

  if (requestedWorkspace) {
    return <IdeShell search={search as IdeShellSearch} onNavigate={handleNavigate} />;
  }

  return <OrgWorkspaceHub invalidWorkspaceId={search.workspace} />;
}

function OrgWorkspaceHub({ invalidWorkspaceId }: { invalidWorkspaceId?: string }) {
  const org = useContext(OrgContext);
  const navigate = useNavigate({ from: "/org/$id" });
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useIDE((s) => s.setActiveWorkspace);
  const addWorkspace = useIDE((s) => s.addWorkspace);
  const connectionErrors = useIDE((s) => s.agentConnectionErrorByWorkspaceId);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!org) return null;

  const openWorkspace = (workspaceId: string) => {
    setActiveWorkspace(workspaceId);
    navigate({
      search: () => ({ workspace: workspaceId }),
    });
  };

  const handleWorkspaceSubmit = async (input: WorkspaceInput) => {
    const id = addWorkspace(input.name, input.source, input.opts);
    setActiveWorkspace(id);
    setDialogOpen(false);
    navigate({
      search: () => ({ workspace: id }),
    });
  };

  return (
    <main className="min-h-svh overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.10),transparent_34%),radial-gradient(circle_at_80%_0%,hsl(var(--accent)/0.45),transparent_30%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))]"
      />
      <section className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-6 py-8">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/80 px-3 py-1 text-[12px] text-muted-foreground shadow-sm">
              <Building2 className="h-3.5 w-3.5" />
              {org.name}
            </div>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              Choose a workspace
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-6 text-muted-foreground">
              Open a project workspace to launch the CLI thread, inspect tasks, and continue work in
              the full IDE.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/settings" search={{ section: "agent" }}>
                <KeyRound className="h-3.5 w-3.5" />
                Global agent
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/settings" search={{ section: "organization" }}>
                <Settings className="h-3.5 w-3.5" />
                Org settings
              </Link>
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setDialogOpen(true)}>
              <FolderPlus className="h-3.5 w-3.5" />
              Add workspace
            </Button>
          </div>
        </header>

        {invalidWorkspaceId && (
          <div className="mt-8 flex items-start gap-2 rounded-xl border border-status-warn/30 bg-status-warn/10 px-4 py-3 text-[13px] text-status-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Workspace "{invalidWorkspaceId}" was not found. Choose an existing workspace below.
          </div>
        )}

        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace, index) => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              active={workspace.id === activeWorkspaceId}
              error={connectionErrors[workspace.id]}
              index={index}
              onOpen={() => openWorkspace(workspace.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="group flex min-h-56 flex-col justify-between rounded-3xl border border-dashed border-border bg-card/45 p-5 text-left transition-all hover:-translate-y-1 hover:border-primary/50 hover:bg-accent/35"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground transition-colors group-hover:text-primary">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[15px] font-semibold">Add a workspace</div>
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
                Create a workspace on an existing agent or clone a repository on an agent.
              </p>
            </div>
          </button>
        </div>

        {workspaces.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/60 px-5 py-8 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-[14px] text-muted-foreground">
              No workspace yet. Add one to start working.
            </p>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>
              Create a workspace on an existing agent or clone a repository on an agent.
            </DialogDescription>
          </DialogHeader>
          <AddWorkspaceForm
            onSubmit={handleWorkspaceSubmit}
            onSuccess={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}

function WorkspaceCard({
  workspace,
  active,
  error,
  index,
  onOpen,
}: {
  workspace: Workspace;
  active: boolean;
  error?: string;
  index: number;
  onOpen: () => void;
}) {
  const sourceMeta = sourceMetadata(workspace);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group min-h-56 rounded-3xl border bg-card/80 p-5 text-left shadow-sm transition-all",
        "hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl hover:shadow-foreground/5",
        active ? "border-primary/60" : "border-border/80",
      )}
      style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl text-base font-semibold text-white shadow-sm"
          style={{ background: workspace.color }}
        >
          {workspace.letter}
        </div>
        <div className="flex flex-col items-end gap-2">
          {active && (
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
          )}
          {error && (
            <Badge
              variant="outline"
              className="border-destructive/30 bg-destructive/5 text-destructive"
            >
              Auth issue
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="truncate text-[17px] font-semibold">{workspace.name}</div>
        <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
          <sourceMeta.Icon className="h-3.5 w-3.5" />
          <span>{sourceMeta.label}</span>
        </div>
      </div>

      <div className="mt-4 min-h-10">
        <p className="line-clamp-2 font-mono text-[11.5px] leading-5 text-muted-foreground">
          {workspace.gitUrl ?? workspace.rootPath ?? sourceMeta.detail}
        </p>
      </div>

      {error && <p className="mt-3 line-clamp-2 text-[11.5px] text-destructive">{error}</p>}

      <div className="mt-5 flex items-center justify-between border-t border-border/70 pt-4 text-[12px] text-muted-foreground">
        <span>Open workspace</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </div>
    </button>
  );
}

function sourceMetadata(workspace: Workspace): {
  label: string;
  detail: string;
  Icon: typeof Server;
} {
  const source = workspace.source;
  if (source.kind === "remote-agent") {
    return { label: "Remote agent", detail: `${source.label} · ${source.url}`, Icon: Server };
  }
  if (source.kind === "local-web") {
    return { label: "Local folder", detail: source.name, Icon: Monitor };
  }
  if (workspace.gitUrl) {
    return { label: "Git repository", detail: workspace.gitUrl, Icon: GitBranch };
  }
  return { label: "Demo workspace", detail: "In-memory demo project", Icon: Globe2 };
}
