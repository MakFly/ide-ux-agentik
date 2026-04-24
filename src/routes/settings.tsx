import { type ReactNode, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";

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

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
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
  const [apiKeyDraft, setApiKeyDraft] = useState(codexApiKey ?? "");

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
            description="Bypass the device-auth flow by providing an API key. Injected into the PTY env when spawning `codex`."
          >
            <div className="py-3">
              <label className="mb-1.5 block text-[13.5px] text-foreground">
                OPENAI_API_KEY
              </label>
              <p className="mb-3 text-[12px] text-muted-foreground">
                Stored in memory only (not persisted). Leave empty to use <code>codex login --device-auth</code>.
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
    </div>
  );
}
