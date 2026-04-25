import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Server, Sparkles, GitBranch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useIDE } from "@/store/ide";
import { pickDirectory, providerFor, isLocalWebSupported, type WorkspaceSource } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { MOCK_ENABLED } from "@/lib/env";

type TabKey = "local" | "remote" | "github" | "mock";

export type WorkspaceInput = {
  name: string;
  source?: WorkspaceSource;
  opts?: { rootPath?: string; gitUrl?: string };
};

function defaultTab(): TabKey {
  if (isLocalWebSupported()) return "local";
  return "remote";
}

function repoBasename(url: string): string {
  // https://github.com/owner/repo(.git)? OR git@host:owner/repo(.git)?
  const cleaned = url.trim().replace(/\.git$/, "");
  const last = cleaned.split(/[/:]/).pop() ?? "";
  return last || "workspace";
}

export type AddWorkspaceFormProps = {
  onSuccess?: () => void;
  onCancel?: () => void;
  onSubmit?: (input: WorkspaceInput) => void | Promise<void>;
};

export function AddWorkspaceForm({ onSuccess, onCancel, onSubmit }: AddWorkspaceFormProps) {
  const addWorkspace = useIDE((s) => s.addWorkspace);
  const setActiveWorkspace = useIDE((s) => s.setActiveWorkspace);
  const workspaces = useIDE((s) => s.workspaces);

  const [tab, setTab] = useState<TabKey>(defaultTab);

  const [mockName, setMockName] = useState("");

  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteLabel, setRemoteLabel] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);

  // GitHub state
  const [ghUrl, setGhUrl] = useState("");
  const [ghName, setGhName] = useState("");
  const [ghNameDirty, setGhNameDirty] = useState(false);
  const [ghDest, setGhDest] = useState("");
  const [ghDestDirty, setGhDestDirty] = useState(false);
  const [ghAgentId, setGhAgentId] = useState<string>("");
  const [ghBusy, setGhBusy] = useState(false);
  const [ghLog, setGhLog] = useState("");
  const ghLogRef = useRef<HTMLTextAreaElement | null>(null);

  const remoteAgentWorkspaces = useMemo(
    () => workspaces.filter((w) => w.source.kind === "remote-agent"),
    [workspaces],
  );

  // Auto-derive workspace name + dest from URL unless user overrode.
  useEffect(() => {
    if (!ghUrl) return;
    const base = repoBasename(ghUrl);
    if (!ghNameDirty) setGhName(base);
    if (!ghDestDirty) setGhDest(`Projects/${base}`);
  }, [ghUrl, ghNameDirty, ghDestDirty]);

  // Default agent selection: first remote-agent workspace.
  useEffect(() => {
    if (!ghAgentId && remoteAgentWorkspaces.length > 0) {
      setGhAgentId(remoteAgentWorkspaces[0]!.id);
    }
  }, [remoteAgentWorkspaces, ghAgentId]);

  // Auto-scroll log to bottom on update.
  useEffect(() => {
    const el = ghLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ghLog]);

  const onPickLocal = async () => {
    try {
      const { handleId, name } = await pickDirectory();
      const source: WorkspaceSource = { kind: "local-web", handleId, name };
      if (onSubmit) {
        await onSubmit({ name, source });
      } else {
        const id = addWorkspace(name, source);
        setActiveWorkspace(id);
        toast.success(`Workspace "${name}" added (local folder)`);
      }
      onSuccess?.();
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "name" in e &&
        (e as { name?: string }).name === "AbortError"
      )
        return;
      toast.error(e instanceof Error ? e.message : "Failed to pick folder");
    }
  };

  const onConnectRemote = async () => {
    const url = remoteUrl.trim();
    const token = remoteToken.trim();
    if (!url || !token) {
      toast.error("URL and token are required");
      return;
    }
    if (!/^wss?:\/\//.test(url)) {
      toast.error("URL must start with ws:// or wss://");
      return;
    }
    let label: string;
    try {
      label = remoteLabel.trim() || new URL(url).host;
    } catch {
      toast.error("Invalid URL");
      return;
    }
    setRemoteBusy(true);
    const source: WorkspaceSource = { kind: "remote-agent", url, token, label };
    try {
      const provider = await providerFor(source, label);
      await provider.list("");
      if (onSubmit) {
        await onSubmit({ name: label, source });
      } else {
        const id = addWorkspace(label, source);
        setActiveWorkspace(id);
        toast.success(`Connected to ${label}`);
      }
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect to agent");
    } finally {
      setRemoteBusy(false);
    }
  };

  const onCreateMock = async () => {
    const name = mockName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (onSubmit) {
      await onSubmit({ name });
    } else {
      const id = addWorkspace(name);
      setActiveWorkspace(id);
      toast.success(`Workspace "${name}" added (demo)`);
    }
    onSuccess?.();
  };

  const ghUrlValid =
    /^(https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+|git@[\w.-]+:[\w.-]+\/[\w.-]+|ssh:\/\/[\w.@:-]+\/[\w.-]+)/.test(
      ghUrl.trim(),
    );

  const onCloneGitBranch = async () => {
    const url = ghUrl.trim();
    const name = ghName.trim();
    const dest = ghDest.trim();
    if (!ghUrlValid) {
      toast.error("Invalid Git URL");
      return;
    }
    if (!name || !dest) {
      toast.error("Name and destination are required");
      return;
    }
    const target = remoteAgentWorkspaces.find((w) => w.id === ghAgentId);
    if (!target || target.source.kind !== "remote-agent") {
      toast.error("Select a connected agent");
      return;
    }
    setGhBusy(true);
    setGhLog("");
    try {
      const provider = (await providerFor(target.source, target.name)) as RemoteAgentProvider;
      const { id: cloneId, dest: resolvedDest } = await provider.gitClone(url, dest);
      const offProgress = provider.onCloneProgress(cloneId, ({ data }) => {
        setGhLog((prev) => prev + data);
      });
      await new Promise<void>((resolve, reject) => {
        const offEnd = provider.onCloneEnd(cloneId, ({ code }) => {
          offProgress();
          offEnd();
          if (code === 0) resolve();
          else reject(new Error(`git clone exited with code ${code}`));
        });
      });
      const install = await provider.gitDetectInstall(resolvedDest);
      if (onSubmit) {
        await onSubmit({
          name,
          source: target.source,
          opts: { rootPath: resolvedDest, gitUrl: url },
        });
      } else {
        const id = addWorkspace(name, target.source, { rootPath: resolvedDest, gitUrl: url });
        setActiveWorkspace(id);
      }
      if (install) {
        toast.success(
          `Cloned into ${resolvedDest}. Suggested install: \`${install.tool} ${install.args.join(" ")}\``,
          { duration: 8000 },
        );
      } else {
        toast.success(`Cloned into ${resolvedDest}`);
      }
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Clone failed";
      toast.error(msg);
      setGhLog((prev) => prev + `\n[error] ${msg}\n`);
    } finally {
      setGhBusy(false);
    }
  };

  const visibleTabs = (MOCK_ENABLED ? 4 : 3) as 3 | 4;
  const tabsListClass = visibleTabs === 4 ? "grid grid-cols-4" : "grid grid-cols-3";

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-2">
        <TabsList className={tabsListClass}>
          <TabsTrigger value="local" disabled={!isLocalWebSupported()}>
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            Local folder
          </TabsTrigger>
          <TabsTrigger value="remote">
            <Server className="mr-1.5 h-3.5 w-3.5" />
            Remote
          </TabsTrigger>
          <TabsTrigger value="github">
            <GitBranch className="mr-1.5 h-3.5 w-3.5" />
            GitHub
          </TabsTrigger>
          {MOCK_ENABLED && (
            <TabsTrigger value="mock">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Demo
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="local" className="space-y-3 py-4">
          {!isLocalWebSupported() ? (
            <p className="text-[13px] text-muted-foreground">
              Your browser does not support picking folders. Use Chrome, Edge, Arc or Brave — or run
              the desktop build (coming soon).
            </p>
          ) : (
            <>
              <p className="text-[13px] text-muted-foreground">
                Pick a folder on this machine. Read + write access is granted per-tab; you'll be
                re-prompted when reopening the app.
              </p>
              <Button onClick={onPickLocal} className="w-full">
                <FolderOpen className="mr-2 h-4 w-4" />
                Pick folder…
              </Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="remote" className="space-y-3 py-4">
          <p className="text-[13px] text-muted-foreground">
            Connect to an <code className="font-mono text-[12px]">ide-ux-agentik</code> agent
            running on another machine. See{" "}
            <code className="font-mono text-[12px]">agent/README.md</code> for install.
          </p>
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-muted-foreground">Agent URL</label>
            <Input
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="wss://my-dev.example.com"
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-muted-foreground">Token</label>
            <Input
              value={remoteToken}
              onChange={(e) => setRemoteToken(e.target.value)}
              placeholder="shared secret"
              type="password"
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-muted-foreground">
              Label (optional)
            </label>
            <Input
              value={remoteLabel}
              onChange={(e) => setRemoteLabel(e.target.value)}
              placeholder="my-server"
            />
          </div>
          <Button onClick={onConnectRemote} disabled={remoteBusy} className="w-full">
            <Server className="mr-2 h-4 w-4" />
            {remoteBusy ? "Connecting…" : "Connect"}
          </Button>
        </TabsContent>

        <TabsContent value="github" className="space-y-3 py-4">
          {remoteAgentWorkspaces.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                Cloning a GitHub repo runs on the agent host (the browser cannot clone). Connect a
                remote agent first.
              </p>
              <Button variant="secondary" onClick={() => setTab("remote")} className="w-full">
                <Server className="mr-2 h-4 w-4" />
                Go to Remote tab
              </Button>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-muted-foreground">
                Clone via the agent's <code className="font-mono text-[12px]">git</code> binary. SSH
                (<code className="font-mono text-[12px]">git@…</code>) uses the agent host's{" "}
                <code className="font-mono text-[12px]">ssh-agent</code>.
              </p>
              <div className="space-y-1">
                <label className="text-[12px] font-medium text-muted-foreground">
                  Repository URL
                </label>
                <Input
                  value={ghUrl}
                  onChange={(e) => setGhUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                  className="font-mono"
                  disabled={ghBusy}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[12px] font-medium text-muted-foreground">
                    Workspace name
                  </label>
                  <Input
                    value={ghName}
                    onChange={(e) => {
                      setGhName(e.target.value);
                      setGhNameDirty(true);
                    }}
                    placeholder="repo"
                    disabled={ghBusy}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[12px] font-medium text-muted-foreground">
                    Clone on agent
                  </label>
                  <Select value={ghAgentId} onValueChange={setGhAgentId} disabled={ghBusy}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {remoteAgentWorkspaces.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[12px] font-medium text-muted-foreground">
                  Destination (relative to agent HOME)
                </label>
                <Input
                  value={ghDest}
                  onChange={(e) => {
                    setGhDest(e.target.value);
                    setGhDestDirty(true);
                  }}
                  placeholder="Projects/repo"
                  className="font-mono"
                  disabled={ghBusy}
                />
              </div>
              {(ghBusy || ghLog) && (
                <div className="space-y-1">
                  <label className="text-[12px] font-medium text-muted-foreground">Clone log</label>
                  <Textarea
                    ref={ghLogRef}
                    value={ghLog}
                    readOnly
                    rows={6}
                    className="font-mono text-[11px]"
                  />
                </div>
              )}
              <Button
                onClick={onCloneGitBranch}
                disabled={ghBusy || !ghUrlValid || !ghAgentId}
                className="w-full"
              >
                <GitBranch className="mr-2 h-4 w-4" />
                {ghBusy ? "Cloning…" : "Clone & open"}
              </Button>
            </>
          )}
        </TabsContent>

        {MOCK_ENABLED && (
          <TabsContent value="mock" className="space-y-3 py-4">
            <p className="text-[13px] text-muted-foreground">
              Create an in-memory demo workspace. No real files — just mocked content for exploring
              the UI.
            </p>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Name</label>
              <Input
                value={mockName}
                onChange={(e) => setMockName(e.target.value)}
                placeholder="my-project"
                onKeyDown={(e) => e.key === "Enter" && onCreateMock()}
              />
            </div>
            <Button onClick={onCreateMock} className="w-full">
              <Sparkles className="mr-2 h-4 w-4" />
              Create demo
            </Button>
          </TabsContent>
        )}
      </Tabs>

      {onCancel && (
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddWorkspaceDialog({ open, onOpenChange }: DialogProps) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add workspace</DialogTitle>
          <DialogDescription>
            Open a local folder, connect a remote agent, or clone a GitHub repo.
          </DialogDescription>
        </DialogHeader>
        <AddWorkspaceForm onSuccess={close} />
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
