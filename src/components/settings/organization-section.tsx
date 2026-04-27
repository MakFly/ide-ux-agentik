import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import { Card, SectionHeader } from "@/components/settings/primitives";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { getStorage, StorageNotConnected } from "@/lib/storage";
import type { Org, User } from "@/lib/types/org";
import { useIDE, type Workspace } from "@/store/ide";

type AgentKey = "codex" | "claude" | "opencode" | "gemini";

function SectionWrap({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

export function OrganizationSection({
  expectedOrgId,
  orgName,
}: {
  expectedOrgId?: string;
  orgName?: string;
}) {
  const [org, setOrg] = useState<Org | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingWorkspaceId, setTestingWorkspaceId] = useState<string | null>(null);
  const updateWorkspace = useIDE((s) => s.updateWorkspace);
  const hydrateTasks = useIDE((s) => s.hydrateTasks);
  const setCurrentOrgId = useIDE((s) => s.setCurrentOrgId);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const storage = getStorage();
        const nextOrg = await storage.getOrg();
        const nextUser = await storage.getUser();
        if (!nextOrg || (expectedOrgId && nextOrg.id !== expectedOrgId)) {
          if (!cancelled) setLoading(false);
          return;
        }
        const nextWorkspaces = await storage.getWorkspaces(nextOrg.id);
        if (cancelled) return;
        setOrg(nextOrg);
        setUser(nextUser);
        setWorkspaces(nextWorkspaces);
        setCurrentOrgId(nextOrg.id);
        setTokenDrafts(
          Object.fromEntries(
            nextWorkspaces
              .filter((workspace) => workspace.source.kind === "remote-agent")
              .map((workspace) => [
                workspace.id,
                workspace.source.kind === "remote-agent" ? workspace.source.token : "",
              ]),
          ),
        );
      } catch (error) {
        if (!(error instanceof StorageNotConnected)) {
          console.warn("[OrganizationSection] Storage error:", error);
        }
        toast.error("Could not load organization settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expectedOrgId, setCurrentOrgId]);

  const remoteWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.source.kind === "remote-agent"),
    [workspaces],
  );

  async function handleSave() {
    if (!org) return;
    if (!org.name.trim() || org.name.length < 2) {
      toast.error("Organization name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      const storage = getStorage();
      await storage.putOrg(org);
      if (user) await storage.putUser(user);
      toast.success("Organization settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveWorkspaceToken(workspace: Workspace) {
    const source = workspace.source;
    if (source.kind !== "remote-agent") return;
    const token = (tokenDrafts[workspace.id] ?? "").trim();
    if (!token) {
      toast.error("Agent token is required");
      return;
    }

    const nextSource = { ...source, token };
    const nextWorkspace: Workspace = { ...workspace, source: nextSource };

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
  }

  if (loading) {
    return (
      <SectionWrap>
        <SectionHeader
          title="Organization"
          description="Loading organization profile and remote-agent workspace credentials."
        />
        <Card>
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading organization settings…
          </div>
        </Card>
      </SectionWrap>
    );
  }

  if (!org) {
    return (
      <SectionWrap>
        <SectionHeader
          title="Organization"
          description="Organization storage is not configured for this installation."
        />
        <Card>
          <div className="flex items-start gap-2 py-5 text-[13px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-status-warn" />
            No organization record was found.
          </div>
        </Card>
      </SectionWrap>
    );
  }

  return (
    <SectionWrap>
      <SectionHeader
        title="Organization"
        description={
          orgName
            ? `${orgName} profile, user defaults, and per-workspace remote-agent tokens.`
            : "Organization profile, user defaults, and per-workspace remote-agent tokens."
        }
      />

      <Card title="Organization">
        <div className="space-y-4 py-4">
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
            <Label htmlFor="org-logo">Logo URL</Label>
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
        <Card title="Profile">
          <div className="space-y-4 py-4">
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
                onChange={(e) => setUser({ ...user, email: e.target.value.trim() || undefined })}
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

      <Card
        title="Remote agent tokens"
        description="Update the shared token used by workspace task hydration and CLI execution."
      >
        <div className="py-4">
          {remoteWorkspaces.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">
              No remote-agent workspace configured for this organization.
            </div>
          ) : (
            <div className="space-y-4">
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
                      <span className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                        {unchanged ? "Current" : "Unsaved"}
                      </span>
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
                        This will reconnect the workspace provider if the token is valid.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? "Saving…" : "Save organization changes"}
        </Button>
      </div>
    </SectionWrap>
  );
}
