import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft, LogOut, RefreshCw, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useIDE, type Theme } from "@/store/ide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { CodexLoginDialog } from "@/components/ide/codex-login-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const settingsSearchSchema = z.object({
  login: z.enum(["codex"]).optional(),
});

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: settingsSearchSchema,
  head: () => ({
    meta: [
      { title: "Settings — Superconductor" },
      { name: "description", content: "Tweak appearance, layout, and AI behavior." },
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
  const codexApiKey = useIDE((s) => s.codexApiKey);
  const setCodexApiKey = useIDE((s) => s.setCodexApiKey);
  const codexAuth = useIDE((s) => s.codexAuth);
  const setCodexAuth = useIDE((s) => s.setCodexAuth);
  const refreshCodexTokens = useIDE((s) => s.refreshCodexTokens);
  const [refreshing, setRefreshing] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(codexApiKey ?? "");
  const { login } = Route.useSearch();
  const [loginOpen, setLoginOpen] = useState(false);
  const openedRef = useRef(false);

  // One-shot auto-open when the URL asks for it. Does NOT clear the URL:
  // closing the dialog just sets loginOpen=false, and the ref guard prevents
  // re-opening on future re-renders.
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
            id="codex"
            title="Codex"
            description="Sign in with ChatGPT to use your Plus / Pro / Team plan, or provide an API key as a bypass."
          >
            <div className="py-4">
              {codexAuth ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13.5px] text-foreground">
                      <Sparkles className="h-3.5 w-3.5 text-status-add" />
                      <span className="truncate">{codexAuth.email ?? "Signed in with ChatGPT"}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
                      plan: {codexAuth.chatgptPlanType ?? "unknown"} · last refresh{" "}
                      {new Date(codexAuth.lastRefresh).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={refreshing}
                      onClick={async () => {
                        setRefreshing(true);
                        const ok = await refreshCodexTokens();
                        setRefreshing(false);
                        if (ok) toast.success("Tokens refreshed.");
                        else toast.error("Refresh failed.");
                      }}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => {
                        setCodexAuth(null);
                        toast.success("Signed out of Codex.");
                      }}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign out
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-[12.5px] text-muted-foreground">
                    Device-code flow via <code className="font-mono">auth.openai.com</code>. Tokens
                    persisted in localStorage.
                  </div>
                  <Button size="sm" className="h-8" onClick={() => setLoginOpen(true)}>
                    Sign in with ChatGPT
                  </Button>
                </div>
              )}
            </div>
            <Separator />
            <div className="py-4">
              <label className="mb-1.5 block text-[13.5px] text-foreground">
                OPENAI_API_KEY <span className="text-[11.5px] text-muted-foreground">(advanced)</span>
              </label>
              <p className="mb-3 text-[12px] text-muted-foreground">
                Alternative to ChatGPT login. Injected as <code>OPENAI_API_KEY</code> into the PTY env
                when spawning <code>codex</code>.
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  className="h-9 flex-1 font-mono text-[12.5px]"
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setCodexApiKey(apiKeyDraft);
                    toast.success(apiKeyDraft ? "API key saved." : "API key cleared.");
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          </Section>
        </div>
      </main>
      <CodexLoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
