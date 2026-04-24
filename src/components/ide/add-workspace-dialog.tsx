import { useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Server, Sparkles } from "lucide-react";
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
import { useIDE } from "@/store/ide";
import { pickDirectory, providerFor, isLocalWebSupported, type WorkspaceSource } from "@/lib/fs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddWorkspaceDialog({ open, onOpenChange }: Props) {
  const addWorkspace = useIDE((s) => s.addWorkspace);
  const [tab, setTab] = useState<"local" | "remote" | "mock">(
    isLocalWebSupported() ? "local" : "mock",
  );

  const [mockName, setMockName] = useState("");

  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteLabel, setRemoteLabel] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);

  const reset = () => {
    setMockName("");
    setRemoteUrl("");
    setRemoteToken("");
    setRemoteLabel("");
    setRemoteBusy(false);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const onPickLocal = async () => {
    try {
      const { handleId, name } = await pickDirectory();
      const source: WorkspaceSource = { kind: "local-web", handleId, name };
      addWorkspace(name, source);
      toast.success(`Workspace "${name}" added (local folder)`);
      close();
    } catch (e) {
      if (e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : "Failed to pick folder");
    }
  };

  const onConnectRemote = async () => {
    const url = remoteUrl.trim();
    const token = remoteToken.trim();
    const label = remoteLabel.trim() || new URL(url).host;
    if (!url || !token) {
      toast.error("URL and token are required");
      return;
    }
    if (!/^wss?:\/\//.test(url)) {
      toast.error("URL must start with ws:// or wss://");
      return;
    }
    setRemoteBusy(true);
    const source: WorkspaceSource = { kind: "remote-agent", url, token, label };
    try {
      const provider = await providerFor(source, label);
      await provider.list("");
      addWorkspace(label, source);
      toast.success(`Connected to ${label}`);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect to agent");
    } finally {
      setRemoteBusy(false);
    }
  };

  const onCreateMock = () => {
    const name = mockName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    addWorkspace(name);
    toast.success(`Workspace "${name}" added (demo)`);
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add workspace</DialogTitle>
          <DialogDescription>Open a local folder, connect a remote agent, or create a demo workspace.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-2">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="local" disabled={!isLocalWebSupported()}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Local folder
            </TabsTrigger>
            <TabsTrigger value="remote">
              <Server className="mr-1.5 h-3.5 w-3.5" />
              Remote
            </TabsTrigger>
            <TabsTrigger value="mock">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Demo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="local" className="space-y-3 py-4">
            {!isLocalWebSupported() ? (
              <p className="text-[13px] text-muted-foreground">
                Your browser does not support picking folders. Use Chrome, Edge, Arc or Brave — or run the desktop build (coming soon).
              </p>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground">
                  Pick a folder on this machine. Read + write access is granted per-tab;
                  you'll be re-prompted when reopening the app.
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
              Connect to an <code className="font-mono text-[12px]">ide-ux-agentik</code> agent running on another
              machine. See <code className="font-mono text-[12px]">agent/README.md</code> for install.
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
              <label className="text-[12px] font-medium text-muted-foreground">Label (optional)</label>
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

          <TabsContent value="mock" className="space-y-3 py-4">
            <p className="text-[13px] text-muted-foreground">
              Create an in-memory demo workspace. No real files — just mocked content for exploring the UI.
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
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
