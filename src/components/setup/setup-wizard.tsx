import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { storage, setEndpoint, resetProviderCache } from "@/lib/storage";
import type { Org, User } from "@/lib/types/org";
import type { Workspace } from "@/store/ide";
import type { WorkspaceSource } from "@/lib/fs";
import { StepOrg } from "./step-org";
import { StepUser } from "./step-user";
import { StepAgent } from "./step-agent";
import { StepWorkspace } from "./step-workspace";

type Step = 1 | 2 | 3 | 4;

type OrgDraft = {
  name: string;
  slug: string;
  logoUrl?: string;
};

type UserDraft = {
  displayName: string;
  email?: string;
  defaultAgent: "codex" | "claude" | "opencode" | "gemini";
};

type AgentDraft = {
  url: string;
  token: string;
  label: string;
} | null;

type WorkspaceDraft = {
  name: string;
  source: WorkspaceSource;
  opts?: { rootPath?: string; gitUrl?: string };
} | null;

const stepNames: Record<Step, string> = {
  1: "Organization",
  2: "User Profile",
  3: "Agent (Optional)",
  4: "First Workspace",
};

export function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);

  const [orgDraft, setOrgDraft] = useState<OrgDraft>({
    name: "",
    slug: "",
  });

  const [userDraft, setUserDraft] = useState<UserDraft>({
    displayName: "",
    email: "",
    defaultAgent: "codex",
  });

  const [agentDraft, setAgentDraft] = useState<AgentDraft>(null);

  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft>(null);

  const handleOrgNext = () => {
    if (!orgDraft.name.trim() || orgDraft.name.length < 2) {
      toast.error("Organization name must be at least 2 characters");
      return;
    }
    setStep(2);
  };

  const handleUserNext = () => {
    if (!userDraft.displayName.trim()) {
      toast.error("Display name is required");
      return;
    }
    setStep(3);
  };

  const handleAgentNext = () => {
    if (!agentDraft) {
      toast.error("Agent URL and token are required (no localStorage fallback)");
      return;
    }
    const url = agentDraft.url.trim();
    const token = agentDraft.token.trim();
    if (!url || !token) {
      toast.error("Agent URL and token are required");
      return;
    }
    // Persist the endpoint immediately so the storage layer (server-backed)
    // can talk to the agent for the rest of the wizard.
    setEndpoint({ url, token, label: agentDraft.label.trim() || new URL(url).host });
    resetProviderCache();
    setStep(4);
  };

  const handleWorkspaceFinish = async () => {
    if (!workspaceDraft) {
      toast.error("Please select or configure a workspace");
      return;
    }

    setBusy(true);
    try {
      // Create org
      const org: Org = {
        id: self.crypto.randomUUID(),
        name: orgDraft.name.trim(),
        slug: orgDraft.slug.trim(),
        logoUrl: orgDraft.logoUrl,
        createdAt: Date.now(),
      };

      // Create user
      const user: User = {
        id: self.crypto.randomUUID(),
        displayName: userDraft.displayName.trim(),
        email: userDraft.email?.trim(),
        defaultAgent: userDraft.defaultAgent,
      };

      // Persist org and user
      await storage.putOrg(org);
      await storage.putUser(user);

      // Create workspace
      const workspace: Workspace = {
        id: self.crypto.randomUUID(),
        name: workspaceDraft.name,
        source: workspaceDraft.source,
        orgId: org.id,
        letter: workspaceDraft.name.charAt(0).toUpperCase(),
        color: "#3b82f6", // default blue
      };

      await storage.putWorkspace(org.id, workspace);

      toast.success("Organization setup complete!");
      navigate({ to: `/org/${org.id}` });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Setup failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const progress = (step / 4) * 100;

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-4 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background:radial-gradient(60%_50%_at_50%_0%,oklch(var(--primary-l,0.55)_var(--primary-c,0.15)_var(--primary-h,260)/0.10)_0%,transparent_70%),radial-gradient(40%_40%_at_85%_100%,oklch(var(--primary-l,0.55)_var(--primary-c,0.15)_var(--primary-h,260)/0.06)_0%,transparent_70%)]"
      />
      <div className="w-full max-w-2xl">
        {/* Wordmark + progress */}
        <div className="mb-6">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            ide-ux-agentik · setup
          </p>
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="text-sm font-medium text-foreground">
              Step {step} of 4 <span className="text-muted-foreground">— {stepNames[step]}</span>
            </h1>
            <span className="font-mono text-[11px] text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>

        {/* Wizard card */}
        <Card className="border-border bg-card p-8 shadow-lg">
          {step === 1 && <StepOrg value={orgDraft} onChange={setOrgDraft} onNext={handleOrgNext} />}

          {step === 2 && (
            <StepUser value={userDraft} onChange={setUserDraft} onNext={handleUserNext} />
          )}

          {step === 3 && (
            <StepAgent value={agentDraft} onChange={setAgentDraft} onNext={handleAgentNext} />
          )}

          {step === 4 && (
            <StepWorkspace
              value={workspaceDraft}
              onChange={setWorkspaceDraft}
              onFinish={handleWorkspaceFinish}
              busy={busy}
              connectedAgent={agentDraft}
            />
          )}

          {/* Navigation buttons */}
          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <Button
              variant="outline"
              onClick={() => {
                if (step > 1) setStep((s) => (s - 1) as Step);
              }}
              disabled={step === 1 || busy}
            >
              Back
            </Button>

            {step === 4 && (
              <Button
                onClick={handleWorkspaceFinish}
                disabled={!workspaceDraft || busy}
                className="ml-auto"
              >
                {busy ? "Setting up your org…" : "Finish setup"}
              </Button>
            )}

            {step < 4 && step !== 3 && (
              <Button
                onClick={() => {
                  if (step === 1) handleOrgNext();
                  else if (step === 2) handleUserNext();
                }}
                disabled={busy}
                className="ml-auto"
              >
                Next
              </Button>
            )}

            {step === 3 && (
              <Button onClick={handleAgentNext} disabled={!agentDraft || busy} className="ml-auto">
                Next
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
