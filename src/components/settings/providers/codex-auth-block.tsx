import { useState } from "react";
import { LogOut, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useIDE } from "@/store/ide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CODEX_MODELS, DEFAULT_CODEX_MODEL } from "@/lib/chat/models";

export function CodexAuthBlock({ onOpenLogin }: { onOpenLogin?: () => void }) {
  const codexAuth = useIDE((s) => s.codexAuth);
  const setCodexAuth = useIDE((s) => s.setCodexAuth);
  const refreshCodexTokens = useIDE((s) => s.refreshCodexTokens);
  const codexApiKey = useIDE((s) => s.codexApiKey);
  const setCodexApiKey = useIDE((s) => s.setCodexApiKey);
  const codexModel = useIDE((s) => s.codexModel);
  const setCodexModel = useIDE((s) => s.setCodexModel);
  const [refreshing, setRefreshing] = useState(false);
  const [apiDraft, setApiDraft] = useState(codexApiKey ?? "");

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="space-y-1.5">
        <label className="text-[11.5px] text-muted-foreground">Model</label>
        <Select
          value={codexModel ?? DEFAULT_CODEX_MODEL}
          onValueChange={(v) => setCodexModel(v === DEFAULT_CODEX_MODEL ? undefined : v)}
        >
          <SelectTrigger data-testid="codex-model-select" className="h-8 text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CODEX_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <div className="flex flex-col">
                  <span className="font-mono text-[12.5px]">{m.label}</span>
                  <span className="text-[10.5px] text-muted-foreground">{m.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {codexAuth ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12.5px] text-foreground">
              <Sparkles className="h-3 w-3 text-status-add" />
              <span className="truncate">{codexAuth.email ?? "Signed in with ChatGPT"}</span>
            </div>
            <div className="font-mono text-[10.5px] text-muted-foreground">
              plan: {codexAuth.chatgptPlanType ?? "unknown"} ·{" "}
              {new Date(codexAuth.lastRefresh).toLocaleString()}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                const ok = await refreshCodexTokens();
                setRefreshing(false);
                if (ok) toast.success("Tokens refreshed.");
                else toast.error("Refresh failed.");
              }}
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => {
                setCodexAuth(null);
                toast.success("Signed out of Codex.");
              }}
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-muted-foreground">
            Browser device-code flow via <code className="font-mono">auth.openai.com</code>.
          </div>
          <Button
            size="sm"
            className="h-7"
            onClick={() => onOpenLogin?.()}
            data-testid="codex-signin"
          >
            Sign in with ChatGPT
          </Button>
        </div>
      )}
      <div className="space-y-1.5">
        <div className="text-[11.5px] text-muted-foreground">
          Fallback: <code className="font-mono">OPENAI_API_KEY</code>
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="sk-..."
            value={apiDraft}
            onChange={(e) => setApiDraft(e.target.value)}
            className="h-8 flex-1 font-mono text-[12px]"
            autoComplete="off"
          />
          <Button
            size="sm"
            className="h-8"
            onClick={() => {
              setCodexApiKey(apiDraft);
              toast.success(apiDraft ? "API key saved." : "API key cleared.");
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
