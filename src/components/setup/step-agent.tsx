import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { providerFor } from "@/lib/fs";

const DEV_AGENT_URL = import.meta.env.VITE_DEV_AGENT_URL as string | undefined;
const DEV_AGENT_TOKEN = import.meta.env.VITE_DEV_AGENT_TOKEN as string | undefined;
const DEV_AGENT_AVAILABLE = !!(DEV_AGENT_URL && DEV_AGENT_TOKEN);

type AgentDraft = {
  url: string;
  token: string;
  label: string;
} | null;

type StepAgentProps = {
  value: AgentDraft;
  onChange: (agent: AgentDraft) => void;
  onNext: () => void;
};

export function StepAgent({ value, onChange, onNext }: StepAgentProps) {
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    if (!value && DEV_AGENT_AVAILABLE) {
      onChange({
        url: DEV_AGENT_URL!,
        token: DEV_AGENT_TOKEN!,
        label: "local-dev",
      });
    }
  }, [value, onChange]);

  const fillFromDev = () => {
    if (!DEV_AGENT_AVAILABLE) return;
    onChange({ url: DEV_AGENT_URL!, token: DEV_AGENT_TOKEN!, label: "local-dev" });
    toast.success("Filled with local dev agent credentials");
  };

  const handleUrlChange = (url: string) => {
    onChange({
      url,
      token: value?.token || "",
      label: value?.label || "",
    });
  };

  const handleTokenChange = (token: string) => {
    onChange({
      url: value?.url || "",
      token,
      label: value?.label || "",
    });
  };

  const handleLabelChange = (label: string) => {
    onChange({
      url: value?.url || "",
      token: value?.token || "",
      label,
    });
  };

  const handleTestConnection = async () => {
    if (!value) {
      toast.error("URL and token are required");
      return;
    }

    const url = value.url.trim();
    const token = value.token.trim();

    if (!url || !token) {
      toast.error("URL and token are required");
      return;
    }

    if (!/^wss?:\/\//.test(url)) {
      toast.error("URL must start with ws:// or wss://");
      return;
    }

    setTestBusy(true);
    try {
      const label = value.label.trim() || new URL(url).host;
      const provider = await providerFor({ kind: "remote-agent", url, token, label }, label);
      await provider.list("");
      toast.success("Connection successful!");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Connection failed";
      toast.error(msg);
    } finally {
      setTestBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && value?.url && value?.token) {
      onNext();
    }
  };

  const isValid = !!(value?.url.trim() && value?.token.trim());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Connect a remote agent (optional)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Link to a remote Codex agent server for enhanced capabilities. You can skip this for now.
        </p>
        {DEV_AGENT_AVAILABLE && (
          <div className="mt-3 flex items-center justify-between rounded-md border border-dashed border-border bg-muted/40 px-3 py-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              dev agent detected · {new URL(DEV_AGENT_URL!).host}
            </span>
            <Button variant="ghost" size="sm" onClick={fillFromDev} className="h-7">
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              Use it
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="agent-url">Agent URL</Label>
          <Input
            id="agent-url"
            placeholder="wss://agent.example.com:8080"
            value={value?.url || ""}
            onChange={(e) => handleUrlChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mt-2"
            autoFocus
          />
          <p className="mt-1 text-xs text-muted-foreground">WebSocket URL (ws:// or wss://)</p>
        </div>

        <div>
          <Label htmlFor="agent-token">Agent Token</Label>
          <Input
            id="agent-token"
            type="password"
            placeholder="your-secret-token"
            value={value?.token || ""}
            onChange={(e) => handleTokenChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-muted-foreground">Authentication token for the agent</p>
        </div>

        <div>
          <Label htmlFor="agent-label">Label (optional)</Label>
          <Input
            id="agent-label"
            placeholder="My Codex Agent"
            value={value?.label || ""}
            onChange={(e) => handleLabelChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-muted-foreground">Display name for this agent</p>
        </div>
      </div>

      {isValid && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestConnection}
          disabled={testBusy}
          className="w-full"
        >
          {testBusy ? "Testing…" : "Test connection"}
        </Button>
      )}

      {isValid && <p className="text-xs text-green-600">✓ Ready to continue</p>}
    </div>
  );
}
