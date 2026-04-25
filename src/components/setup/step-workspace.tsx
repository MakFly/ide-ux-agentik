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
};

export function StepWorkspace({ value, onChange, onFinish, busy }: StepWorkspaceProps) {
  const handleSubmit = (input: WorkspaceInput) => {
    onChange(input as WorkspaceDraft);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Create your first workspace</h2>
        <p className="mt-2 text-sm text-slate-600">
          A workspace is a project folder or remote agent where you'll work. You can add more later.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <AddWorkspaceForm onSubmit={handleSubmit} onCancel={undefined} />
      </div>

      {value && (
        <div className="rounded-lg bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">
            ✓ Selected: <span className="font-semibold">{value.name}</span>
          </p>
        </div>
      )}

      <Button onClick={onFinish} disabled={!value || busy} className="w-full" size="lg">
        {busy ? "Setting up your org…" : "Finish setup"}
      </Button>
    </div>
  );
}
