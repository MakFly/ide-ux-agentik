import { Server, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddWorkspaceForm, type WorkspaceInput } from "@/components/ide/add-workspace-dialog";
import type { WorkspaceSource } from "@/lib/fs";

type WorkspaceDraft = {
  name: string;
  source: WorkspaceSource;
  opts?: { rootPath?: string; gitUrl?: string };
} | null;

type StepWorkspaceProps = {
  value: WorkspaceDraft;
  onChange: (workspace: WorkspaceDraft) => void;
  onFinish: () => void;
  busy: boolean;
  connectedAgent?: { url: string; token: string; label: string } | null;
};

export function StepWorkspace({
  value,
  onChange,
  onFinish,
  busy,
  connectedAgent,
}: StepWorkspaceProps) {
  const handleSubmit = (input: WorkspaceInput) => {
    onChange(input as WorkspaceDraft);
  };

  const useConnectedAgent = () => {
    if (!connectedAgent) return;
    onChange({
      name: connectedAgent.label,
      source: { kind: "remote-agent", ...connectedAgent },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Create your first workspace</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A workspace is a project folder or remote agent where you'll work. You can add more later.
        </p>
      </div>

      {connectedAgent && (
        <button
          type="button"
          onClick={useConnectedAgent}
          className="group flex w-full items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-left transition hover:border-foreground/30 hover:bg-muted/60"
        >
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              Use connected agent ({connectedAgent.label})
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              workspace root = agent's <code>AGENT_ROOT</code> · {connectedAgent.url}
            </p>
          </div>
          <span className="shrink-0 self-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
            one-click
          </span>
        </button>
      )}

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {connectedAgent ? "or pick another source" : "pick a source"}
        </p>
        <AddWorkspaceForm onSubmit={handleSubmit} onCancel={undefined} />
      </div>

      {value && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5">
          <Check className="h-4 w-4 shrink-0 text-foreground" />
          <p className="text-sm text-muted-foreground">
            Selected: <span className="font-medium text-foreground">{value.name}</span>
          </p>
        </div>
      )}

      <Button onClick={onFinish} disabled={!value || busy} className="w-full" size="lg">
        {busy ? "Setting up your org…" : "Finish setup"}
      </Button>
    </div>
  );
}
