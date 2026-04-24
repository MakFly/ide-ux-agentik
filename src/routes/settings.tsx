import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Loader2,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { useIDE, type Theme } from "@/store/ide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodexLoginDialog } from "@/components/ide/codex-login-dialog";
import {
  PROVIDER_CHECKS,
  PROVIDER_META,
  type CheckResult,
  type CheckStatus,
  type ProviderId,
  emptyResult,
} from "@/lib/providers-check";

const settingsSearchSchema = z.object({
  login: z.enum(["codex"]).optional(),
});

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: settingsSearchSchema,
  head: () => ({
    meta: [
      { title: "Settings — Superconductor" },
      { name: "description", content: "Tweak appearance, layout, and AI providers." },
    ],
  }),
});

function Row({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-[13.5px] text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div>}
      </div>
      {control}
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <header className="mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
        )}
      </header>
      <div className="rounded-lg border border-border bg-card px-4 py-1">{children}</div>
    </section>
  );
}

function statusIcon(s: CheckStatus) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (s) {
    case "ok":
      return <CheckCircle2 className={`${cls} text-status-add`} />;
    case "warn":
      return <CircleAlert className={`${cls} text-status-warn`} />;
    case "fail":
      return <XCircle className={`${cls} text-status-del`} />;
    case "running":
      return <Loader2 className={`${cls} animate-spin text-muted-foreground`} />;
    default:
      return <CircleDashed className={`${cls} text-muted-foreground`} />;
  }
}

function SettingsPage() {
  const theme = useIDE((s) => s.theme);
  const setTheme = useIDE((s) => s.setTheme);
  const showSidebar = useIDE((s) => s.showSidebar);
  const toggleSidebar = useIDE((s) => s.toggleSidebar);
  const showFiles = useIDE((s) => s.showFiles);
  const toggleFiles = useIDE((s) => s.toggleFiles);
  const thinking = useIDE((s) => s.thinking);
  const toggleThinking = useIDE((s) => s.toggleThinking);
  const filesTab = useIDE((s) => s.filesTab);
  const setFilesTab = useIDE((s) => s.setFilesTab);
  const { login } = Route.useSearch();
  const [loginOpen, setLoginOpen] = useState(false);
  const openedRef = useRef(false);

  useEffect(() => {
    if (login === "codex" && !openedRef.current) {
      openedRef.current = true;
      setLoginOpen(true);
    }
  }, [login]);

  return (
    <div
      className="flex min-h-svh flex-col bg-background text-foreground"
      style={{ viewTransitionName: "settings-page" }}
      data-login-open={String(loginOpen)}
    >
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Button asChild variant="ghost" size="sm" className="h-8 gap-2 px-2">
            <Link to="/" viewTransition>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-[15px] font-semibold">Settings</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="flex flex-col gap-8">
          <Section id="appearance" title="Appearance">
            <Row
              label="Dark mode"
              hint="Apply the app-wide dark or light theme."
              control={
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(v) => setTheme(v ? "dark" : ("light" as Theme))}
                />
              }
            />
          </Section>

          <Section id="layout" title="Layout">
            <Row
              label="Show sidebar"
              control={<Switch checked={showSidebar} onCheckedChange={() => toggleSidebar()} />}
            />
            <Separator />
            <Row
              label="Show files panel"
              control={<Switch checked={showFiles} onCheckedChange={() => toggleFiles()} />}
            />
            <Separator />
            <Row
              label="Default files tab"
              control={
                <Select value={filesTab} onValueChange={(v) => setFilesTab(v as typeof filesTab)}>
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="files">Files</SelectItem>
                    <SelectItem value="changes">Changes</SelectItem>
                    <SelectItem value="checks">Checks</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </Section>

          <Section id="ai" title="AI">
            <Row
              label="Thinking mode"
              hint="Show internal reasoning in chat."
              control={<Switch checked={thinking} onCheckedChange={() => toggleThinking()} />}
            />
          </Section>

          <Section
            id="providers"
            title="Providers"
            description="One-click health checks for each CLI agent on the active remote-agent workspace."
          >
            <ProviderCard provider="codex" onOpenLogin={() => setLoginOpen(true)} />
            <Separator />
            <ProviderCard provider="claude" />
            <Separator />
            <ProviderCard provider="opencode" />
            <Separator />
            <ProviderCard provider="gemini" />
          </Section>
        </div>
      </main>
      <CodexLoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}

function ProviderCard({
  provider,
  onOpenLogin,
}: {
  provider: ProviderId;
  onOpenLogin?: () => void;
}) {
  const meta = PROVIDER_META[provider];
  const [result, setResult] = useState<CheckResult>(emptyResult());
  const [running, setRunning] = useState(false);

  async function runCheck() {
    setRunning(true);
    setResult((r) => ({ ...r, status: "running", summary: "Running…" }));
    try {
      const next = await PROVIDER_CHECKS[provider]();
      setResult(next);
    } catch (e) {
      setResult({
        status: "fail",
        summary: e instanceof Error ? e.message : String(e),
        details: [],
        runAt: new Date().toISOString(),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="py-4" data-provider={provider}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={meta.icon}
            alt={meta.label}
            className="h-6 w-6 shrink-0 rounded-[4px] bg-white/5 object-contain p-0.5"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-foreground">
              {meta.label}
              {statusIcon(result.status)}
            </div>
            <div className="truncate text-[12px] text-muted-foreground">{meta.description}</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => void runCheck()}
          disabled={running}
          data-testid={`check-${provider}`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
          Check
        </Button>
      </div>

      {result.status !== "unknown" && (
        <div className="mt-3 rounded-md border border-border bg-code-bg/40 px-3 py-2 text-[12px]">
          <div
            className={`font-medium ${
              result.status === "ok"
                ? "text-status-add"
                : result.status === "warn"
                  ? "text-status-warn"
                  : result.status === "fail"
                    ? "text-status-del"
                    : "text-muted-foreground"
            }`}
            data-testid={`check-${provider}-summary`}
          >
            {result.summary}
          </div>
          {result.details.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.details.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground"
                >
                  {d.ok ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-status-add" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-status-del" />
                  )}
                  <span className="text-foreground">{d.label}:</span>
                  <span className="truncate">{d.value}</span>
                </li>
              ))}
            </ul>
          )}
          {result.runAt && (
            <div className="mt-2 text-[10.5px] text-muted-foreground">
              last check {new Date(result.runAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {provider === "codex" && <CodexAuthBlock onOpenLogin={onOpenLogin} />}
      {provider === "claude" && <AnthropicApiKeyBlock />}
      {provider === "gemini" && <GeminiApiKeyBlock />}
    </div>
  );
}

function CodexAuthBlock({ onOpenLogin }: { onOpenLogin?: () => void }) {
  const codexAuth = useIDE((s) => s.codexAuth);
  const setCodexAuth = useIDE((s) => s.setCodexAuth);
  const refreshCodexTokens = useIDE((s) => s.refreshCodexTokens);
  const codexApiKey = useIDE((s) => s.codexApiKey);
  const setCodexApiKey = useIDE((s) => s.setCodexApiKey);
  const [refreshing, setRefreshing] = useState(false);
  const [apiDraft, setApiDraft] = useState(codexApiKey ?? "");

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
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

function AnthropicApiKeyBlock() {
  return (
    <div className="mt-3 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
      Auth handled entirely on the agent host via <code className="font-mono">claude login</code>.
      Credentials live at <code className="font-mono">~/.claude/.credentials.json</code>.
    </div>
  );
}

function GeminiApiKeyBlock() {
  return (
    <div className="mt-3 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
      Set <code className="font-mono">GEMINI_API_KEY</code> (or <code>GOOGLE_API_KEY</code>) in
      the agent host environment, or run <code className="font-mono">gcloud auth application-default login</code>.
    </div>
  );
}
