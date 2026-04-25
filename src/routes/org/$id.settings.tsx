import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { getStorage } from "@/lib/storage";
import type { Org, User } from "@/lib/types/org";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const storage = getStorage();
      const o = await storage.getOrg();
      const u = await storage.getUser();
      if (!o || o.id !== paramId) {
        navigate({ to: "/", replace: true });
        return;
      }
      setOrg(o);
      setUser(u);
      setLoading(false);
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
