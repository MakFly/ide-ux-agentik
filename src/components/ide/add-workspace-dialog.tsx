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
import { providerFor, type WorkspaceSource } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { MOCK_ENABLED } from "@/lib/env";

type TabKey = "workspace" | "github" | "connect" | "mock";

export type WorkspaceInput = {
  name: string;
  source?: WorkspaceSource;
  opts?: {
    rootPath?: string;
    gitUrl?: string;
    rootPathOwnership?: "user-selected" | "app-created";
  };
};

function repoBasename(url: string): string {
  // https://github.com/owner/repo(.git)? OR git@host:owner/repo(.git)?
  const cleaned = url.trim().replace(/\.git$/, "");
  const last = cleaned.split(/[/:]/).pop() ?? "";
  return last || "workspace";
}

function basenameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() || "workspace";
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

  const initialHasRemoteAgents = workspaces.some((w) => w.source.kind === "remote-agent");
  const [tab, setTab] = useState<TabKey>(initialHasRemoteAgents ? "workspace" : "connect");

  const [mockName, setMockName] = useState("");

  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceNameDirty, setWorkspaceNameDirty] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceAgentId, setWorkspaceAgentId] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspacePickerBusy, setWorkspacePickerBusy] = useState(false);

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
  const hasRemoteAgents = remoteAgentWorkspaces.length > 0;
  const selectedWorkspaceAgent = useMemo(
    () =>
      remoteAgentWorkspaces.find((w) => w.id === workspaceAgentId) ??
      remoteAgentWorkspaces[0] ??
      null,
    [remoteAgentWorkspaces, workspaceAgentId],
  );

  useEffect(() => {
    if (hasRemoteAgents && tab === "connect") {
      setTab("workspace");
    }
    if (!hasRemoteAgents && (tab === "workspace" || tab === "github")) {
      setTab("connect");
    }
  }, [hasRemoteAgents, tab]);

  useEffect(() => {
    if (!workspaceAgentId && remoteAgentWorkspaces.length > 0) {
      setWorkspaceAgentId(remoteAgentWorkspaces[0]!.id);
    }
  }, [remoteAgentWorkspaces, workspaceAgentId]);

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

  const selectWorkspacePath = (path: string, name: string) => {
    setWorkspacePath(path);
    if (!workspaceNameDirty) {
      setWorkspaceName(name || basenameFromPath(path));
    }
  };

  const onPickWorkspaceFolder = async () => {
    const target = selectedWorkspaceAgent;
    if (!target || target.source.kind !== "remote-agent") {
      toast.error("No connected agent is available");
      return;
    }
    setWorkspacePickerBusy(true);
    try {
      const provider = (await providerFor(target.source, target.name)) as RemoteAgentProvider;
      const picked = await provider.hostPickDirectory();
      if (!picked) return;
      selectWorkspacePath(picked.path, picked.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the system folder picker");
    } finally {
      setWorkspacePickerBusy(false);
    }
  };

  const onOpenAgentWorkspace = async () => {
    const name = workspaceName.trim();
    const rootPath = workspacePath.trim();
    if (!name || !rootPath) {
      toast.error("Select a folder and confirm the workspace name");
      return;
    }
    const target = selectedWorkspaceAgent;
    if (!target || target.source.kind !== "remote-agent") {
      toast.error("No connected agent is available");
      return;
    }
    setWorkspaceBusy(true);
    try {
      const provider = (await providerFor(target.source, target.name)) as RemoteAgentProvider;
      const stat = await provider.stat(rootPath);
      if (stat.type !== "directory") {
        toast.error(`Selected path is not a folder: ${rootPath}`);
        return;
      }
      if (onSubmit) {
        await onSubmit({
          name,
          source: target.source,
          opts: { rootPath, rootPathOwnership: "user-selected" },
        });
      } else {
        const id = addWorkspace(name, target.source, {
          rootPath,
          rootPathOwnership: "user-selected",
        });
        setActiveWorkspace(id);
      }
      toast.success(`Workspace opened from ${target.name}`);
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open workspace on agent");
    } finally {
      setWorkspaceBusy(false);
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
          opts: {
            rootPath: resolvedDest,
            gitUrl: url,
            rootPathOwnership: "app-created",
          },
        });
      } else {
        const id = addWorkspace(name, target.source, {
          rootPath: resolvedDest,
          gitUrl: url,
          rootPathOwnership: "app-created",
        });
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

  const visibleTabs = (hasRemoteAgents ? 2 : 1) + (MOCK_ENABLED ? 1 : 0);
  const tabsListClass =
    visibleTabs === 3
      ? "grid grid-cols-3"
      : visibleTabs === 2
        ? "grid grid-cols-2"
        : "grid grid-cols-1";

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-2">
        <TabsList className={tabsListClass}>
          {hasRemoteAgents ? (
            <>
              <TabsTrigger value="workspace">
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                New workspace
              </TabsTrigger>
              <TabsTrigger value="github">
                <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                Clone repo
              </TabsTrigger>
            </>
          ) : (
            <TabsTrigger value="connect">
              <Server className="mr-1.5 h-3.5 w-3.5" />
              Connect agent
            </TabsTrigger>
          )}
          {MOCK_ENABLED && (
            <TabsTrigger value="mock">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Demo
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="workspace" className="space-y-3 py-4">
          <p className="text-[13px] text-muted-foreground">
            Select an existing folder from this machine through the connected agent. The agent is
            reused automatically, so the workspace opens directly with Agent State.
          </p>
          {remoteAgentWorkspaces.length > 1 ? (
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Machine</label>
              <Select
                value={workspaceAgentId}
                onValueChange={(next) => {
                  setWorkspaceAgentId(next);
                  setWorkspacePath("");
                  setWorkspaceName("");
                  setWorkspaceNameDirty(false);
                }}
                disabled={workspaceBusy}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select machine" />
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
          ) : (
            <div className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-[12px] text-muted-foreground">
              Machine:{" "}
              <code className="font-mono text-[12px] text-foreground">
                {selectedWorkspaceAgent?.name ?? "connected agent"}
              </code>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full justify-center gap-2"
            disabled={workspacePickerBusy || workspaceBusy}
            onClick={onPickWorkspaceFolder}
          >
            <FolderOpen className="h-4 w-4" />
            {workspacePickerBusy ? "Opening file system…" : "Choose folder from file system…"}
          </Button>
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-muted-foreground">Selected folder</label>
            <Input
              value={workspacePath}
              readOnly
              placeholder="Choose a folder from the file system"
              className="font-mono"
              disabled={workspaceBusy}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] font-medium text-muted-foreground">Workspace name</label>
            <Input
              value={workspaceName}
              onChange={(e) => {
                setWorkspaceName(e.target.value);
                setWorkspaceNameDirty(true);
              }}
              placeholder="Choose a folder first"
              disabled={workspaceBusy}
              onKeyDown={(e) => e.key === "Enter" && onOpenAgentWorkspace()}
            />
          </div>
          <Button
            onClick={onOpenAgentWorkspace}
            disabled={workspaceBusy || !workspaceName.trim() || !workspacePath.trim()}
            className="w-full"
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {workspaceBusy ? "Opening…" : "Open folder as workspace"}
          </Button>
        </TabsContent>

        <TabsContent value="connect" className="space-y-3 py-4">
          <p className="text-[13px] text-muted-foreground">
            No connected agent is available yet. Connect one once, then new workspaces and GitHub
            clones can be created on that agent without re-entering it.
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
            {remoteBusy ? "Connecting…" : "Connect remote agent"}
          </Button>
        </TabsContent>

        <TabsContent value="github" className="space-y-3 py-4">
          {remoteAgentWorkspaces.length === 0 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                Cloning a repository runs on an agent host so the created workspace keeps the Agent
                State UI. Connect a remote agent first.
              </p>
              <Button variant="secondary" onClick={() => setTab("connect")} className="w-full">
                <Server className="mr-2 h-4 w-4" />
                Connect a remote agent
              </Button>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-muted-foreground">
                Clone a repository on an agent. The resulting workspace stays connected to that
                agent and opens with Agent State, not the legacy local-folder UI.
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
                {ghBusy ? "Cloning…" : "Clone repository on agent"}
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
            Create a workspace on an existing agent or clone a repository on an agent.
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
