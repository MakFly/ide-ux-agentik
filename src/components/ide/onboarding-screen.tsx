import { AddWorkspaceForm } from "./add-workspace-dialog";

export function OnboardingScreen() {
  return (
    <div className="flex h-svh w-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-[560px] rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-6 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to ide-ux-agentik</h1>
          <p className="text-sm text-muted-foreground">
            Create your first workspace to get started. Open a local folder, connect a remote agent,
            or clone a GitHub repository.
          </p>
        </div>
        <AddWorkspaceForm />
      </div>
    </div>
  );
}
