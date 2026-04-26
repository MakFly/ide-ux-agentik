import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { getStorage, StorageNotConnected } from "@/lib/storage";
import type { Org, User } from "@/lib/types/org";
import { useIDE, type Workspace } from "@/store/ide";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/org/$id/settings")({
  component: OrgSettings,
});

type AgentKey = "codex" | "claude" | "opencode" | "gemini";

function OrgSettings() {
  const { id: paramId } = Route.useParams();
  const navigate = useNavigate();

  const [org, setOrg] = useState<Org | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingWorkspaceId, setTestingWorkspaceId] = useState<string | null>(null);
  const updateWorkspace = useIDE((s) => s.updateWorkspace);
  const hydrateTasks = useIDE((s) => s.hydrateTasks);

  useEffect(() => {
    void (async () => {
      try {
        const storage = getStorage();
        const o = await storage.getOrg();
        const u = await storage.getUser();
        if (!o || o.id !== paramId) {
          navigate({ to: "/", replace: true });
          return;
        }
        const ws = await storage.getWorkspaces(o.id);
        setOrg(o);
        setUser(u);
        setWorkspaces(ws);
        setTokenDrafts(
          Object.fromEntries(
            ws
              .filter((workspace) => workspace.source.kind === "remote-agent")
              .map((workspace) => [
                workspace.id,
                workspace.source.kind === "remote-agent" ? workspace.source.token : "",
              ]),
          ),
        );
        setLoading(false);
      } catch (error) {
        if (error instanceof StorageNotConnected) {
          navigate({ to: "/", replace: true });
        } else {
          console.warn("[OrgSettings] Storage error:", error);
          navigate({ to: "/", replace: true });
        }
      }
    })();
  }, [paramId, navigate]);

  if (loading || !org) {
    return <div className="h-svh w-screen bg-background" />;
  }

  const handleSave = async () => {
    if (!org.name.trim() || org.name.length < 2) {
      toast.error("Organization name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      const storage = getStorage();
      await storage.putOrg(org);
      if (user) await storage.putUser(user);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWorkspaceToken = async (workspace: Workspace) => {
    const source = workspace.source;
    if (source.kind !== "remote-agent") return;
    const token = (tokenDrafts[workspace.id] ?? "").trim();
    if (!token) {
      toast.error("Agent token is required");
      return;
    }

    const nextSource = {
      ...source,
      token,
    };
    const nextWorkspace: Workspace = {
      ...workspace,
      source: nextSource,
    };

    setTestingWorkspaceId(workspace.id);
    const provider = new RemoteAgentProvider(nextSource.label, nextSource.url, nextSource.token);
    try {
      await provider.connect();
      await provider.disconnect().catch(() => {});
      await updateWorkspace(nextWorkspace);
      setWorkspaces((prev) => prev.map((w) => (w.id === workspace.id ? nextWorkspace : w)));
      await hydrateTasks(workspace.id);
      toast.success(`Token updated for ${workspace.name}`);
    } catch (e) {
      await provider.disconnect().catch(() => {});
      toast.error(e instanceof Error ? e.message : "Agent authentication failed");
    } finally {
      setTestingWorkspaceId(null);
    }
  };

  const remoteWorkspaces = workspaces.filter(
    (workspace) => workspace.source.kind === "remote-agent",
  );

  return (
    <div className="min-h-svh bg-background p-6 text-foreground">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/org/$id"
          params={{ id: org.id }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to workspace
        </Link>

        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>

        <div className="space-y-6">
          <Card className="border-border bg-card p-6">
            <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Organization
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={org.name}
                  onChange={(e) => setOrg({ ...org, name: e.target.value })}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="org-slug">URL slug</Label>
                <Input
                  id="org-slug"
                  value={org.slug}
                  onChange={(e) =>
                    setOrg({
                      ...org,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                    })
                  }
                  className="mt-2 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="org-logo">Logo URL (optional)</Label>
                <Input
                  id="org-logo"
                  value={org.logoUrl ?? ""}
                  onChange={(e) => setOrg({ ...org, logoUrl: e.target.value.trim() || undefined })}
                  placeholder="https://…"
                  className="mt-2"
                />
              </div>
              <p className="font-mono text-[11px] text-muted-foreground">
                created · {new Date(org.createdAt).toLocaleString()}
              </p>
            </div>
          </Card>

          {user && (
            <Card className="border-border bg-card p-6">
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Profile
              </h2>
              <div className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="user-name">Display name</Label>
                  <Input
                    id="user-name"
                    value={user.displayName}
                    onChange={(e) => setUser({ ...user, displayName: e.target.value })}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="user-email">Email</Label>
                  <Input
                    id="user-email"
                    type="email"
                    value={user.email ?? ""}
                    onChange={(e) =>
                      setUser({ ...user, email: e.target.value.trim() || undefined })
                    }
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="user-agent">Default AI Assistant</Label>
                  <Select
                    value={user.defaultAgent}
                    onValueChange={(v) => setUser({ ...user, defaultAgent: v as AgentKey })}
                  >
                    <SelectTrigger id="user-agent" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                      <SelectItem value="opencode">OpenCode</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>
          )}

          <Card className="border-border bg-card p-6">
            <div className="mb-1 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Remote agent tokens
              </h2>
            </div>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              Update the shared token used by workspace task hydration and CLI execution. The token
              is tested before it is saved.
            </p>

            {remoteWorkspaces.length === 0 ? (
              <div className="mt-4 rounded-md border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">
                No remote-agent workspace configured for this organization.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {remoteWorkspaces.map((workspace) => {
                  if (workspace.source.kind !== "remote-agent") return null;
                  const draft = tokenDrafts[workspace.id] ?? "";
                  const unchanged = draft.trim() === workspace.source.token;
                  const busy = testingWorkspaceId === workspace.id;
                  return (
                    <div
                      key={workspace.id}
                      className="rounded-lg border border-border/80 bg-background/45 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-[13.5px]">{workspace.name}</div>
                          <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                            {workspace.source.label} · {workspace.source.url}
                          </div>
                        </div>
                        {unchanged ? (
                          <span className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                            Current
                          </span>
                        ) : (
                          <span className="rounded bg-status-warn/15 px-2 py-1 text-[11px] text-status-warn">
                            Unsaved
                          </span>
                        )}
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <div>
                          <Label htmlFor={`agent-token-${workspace.id}`}>Token</Label>
                          <Input
                            id={`agent-token-${workspace.id}`}
                            type="password"
                            autoComplete="off"
                            value={draft}
                            onChange={(e) =>
                              setTokenDrafts((prev) => ({
                                ...prev,
                                [workspace.id]: e.target.value,
                              }))
                            }
                            className="mt-2 font-mono"
                            placeholder="Paste the agent token"
                          />
                        </div>
                        <Button
                          className="self-end gap-2"
                          onClick={() => handleSaveWorkspaceToken(workspace)}
                          disabled={busy || !draft.trim() || unchanged}
                        >
                          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {busy ? "Testing…" : "Test & save"}
                        </Button>
                      </div>
                      {!unchanged && (
                        <div className="mt-3 flex items-start gap-2 text-[11.5px] text-status-warn">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          This will reconnect the workspace provider and clear the current auth
                          error if the token is valid.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => navigate({ to: "/org/$id", params: { id: org.id } })}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
