import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { providerFor } from "@/lib/fs";

type AgentDraft = {
  url: string;
  token: string;
  label: string;
} | null;

type StepAgentProps = {
  value: AgentDraft;
  onChange: (agent: AgentDraft) => void;
  onNext: () => void;
  onSkip: () => void;
};

export function StepAgent({ value, onChange, onNext, onSkip }: StepAgentProps) {
  const [testBusy, setTestBusy] = useState(false);

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
        <h2 className="text-xl font-semibold text-slate-900">Connect a remote agent (optional)</h2>
        <p className="mt-2 text-sm text-slate-600">
          Link to a remote Codex agent server for enhanced capabilities. You can skip this for now.
        </p>
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
          <p className="mt-1 text-xs text-slate-500">WebSocket URL (ws:// or wss://)</p>
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
          <p className="mt-1 text-xs text-slate-500">Authentication token for the agent</p>
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
          <p className="mt-1 text-xs text-slate-500">Display name for this agent</p>
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
