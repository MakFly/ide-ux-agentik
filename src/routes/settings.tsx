import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { useIDE, type Theme } from "@/store/ide";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Kbd } from "@/components/ui/kbd";
import { CodexLoginDialog } from "@/components/ide/codex-login-dialog";
import { PROVIDER_META, type ProviderId } from "@/lib/providers-check";
import { cn } from "@/lib/utils";
import { Card, Row, SectionHeader } from "@/components/settings/primitives";
import { ProviderCard } from "@/components/settings/providers/provider-card";
import { SettingsSidebar, type SectionId } from "@/components/settings/settings-sidebar";
import { CommandPalette } from "@/components/settings/command-palette";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { useMcpServers } from "@/lib/mcp/use-mcp-servers";
import { mcpClient } from "@/lib/mcp/client";
import type { McpEntry, McpServer } from "@/lib/mcp/types";
import { providerFor } from "@/lib/fs";
import type { RemoteAgentProvider } from "@/lib/fs/remote-agent";

const SECTION_IDS = ["appearance", "layout", "ai", "providers", "mcp"] as const;
const PROVIDER_IDS = ["codex", "claude", "opencode", "gemini"] as const;

const settingsSearchSchema = z.object({
  login: z.enum(["codex"]).optional(),
  section: z.enum(SECTION_IDS).optional(),
  provider: z.enum(PROVIDER_IDS).optional(),
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

function SettingsPage() {
  const { login, section: urlSection, provider: urlProvider } = Route.useSearch();
  const navigate = useNavigate({ from: "/settings" });

  const section: SectionId = urlSection ?? "appearance";
  const provider = urlProvider;

  const [loginOpen, setLoginOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openedRef = useRef(false);

  const collapsed = useIDE((s) => s.settingsSidebarCollapsed);
  const toggleCollapsed = useIDE((s) => s.toggleSettingsSidebar);

  useEffect(() => {
    if (login === "codex" && !openedRef.current) {
      openedRef.current = true;
      setLoginOpen(true);
    }
  }, [login]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const navigateTo = useCallback(
    (next: SectionId, nextProvider?: ProviderId) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          section: next,
          provider: next === "providers" ? nextProvider : undefined,
        }),
      });
    },
    [navigate],
  );

  const breadcrumb = useMemo(() => {
    const parts: string[] = ["Settings", sectionLabel(section)];
    if (section === "providers" && provider) parts.push(PROVIDER_META[provider].label);
    return parts;
  }, [section, provider]);

  return (
    <div
      className="flex min-h-svh flex-col bg-background text-foreground"
      style={{ viewTransitionName: "settings-page" }}
      data-login-open={String(loginOpen)}
    >
      <header className="sticky top-0 z-20 h-12 border-b border-border/80 bg-background/80 backdrop-blur">
        <div className="flex h-full items-center gap-3 px-4">
          <Button asChild variant="ghost" size="sm" className="h-8 gap-2 px-2">
            <Link to="/" viewTransition>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
            <nav className="flex items-center gap-1.5 text-[13px]">
              {breadcrumb.map((part, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted-foreground/60">/</span>}
                  <span
                    className={cn(
                      i === breadcrumb.length - 1
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {part}
                  </span>
                </span>
              ))}
            </nav>
          </div>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-56 justify-start gap-2 px-2.5 text-[12.5px] text-muted-foreground"
              onClick={() => setPaletteOpen(true)}
              data-testid="settings-find"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Find…</span>
              <Kbd>⌘K</Kbd>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <SettingsSidebar
          section={section}
          provider={provider}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onNavigate={navigateTo}
        />

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-3xl px-8 py-10">
            {section === "appearance" && <AppearanceSection />}
            {section === "layout" && <LayoutSection />}
            {section === "ai" && <AISection />}
            {section === "providers" && (
              <ProvidersSection
                provider={provider}
                onOpenLogin={() => setLoginOpen(true)}
                onNavigate={navigateTo}
              />
            )}
            {section === "mcp" && <McpSection />}
          </div>
        </main>
      </div>

      <CodexLoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={navigateTo} />
    </div>
  );
}

function sectionLabel(id: SectionId): string {
  switch (id) {
    case "appearance":
      return "Appearance";
    case "layout":
      return "Layout";
    case "ai":
      return "AI";
    case "providers":
      return "Providers";
    case "mcp":
      return "MCP Servers";
  }
}

function SectionWrap({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

function AppearanceSection() {
  const theme = useIDE((s) => s.theme);
  const setTheme = useIDE((s) => s.setTheme);
  return (
    <SectionWrap>
      <SectionHeader title="Appearance" description="How Superconductor looks on your screen." />
      <Card>
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
      </Card>
    </SectionWrap>
  );
}

function LayoutSection() {
  const showSidebar = useIDE((s) => s.showSidebar);
  const toggleSidebar = useIDE((s) => s.toggleSidebar);
  const showFiles = useIDE((s) => s.showFiles);
  const toggleFiles = useIDE((s) => s.toggleFiles);
  const filesTab = useIDE((s) => s.filesTab);
  const setFilesTab = useIDE((s) => s.setFilesTab);
  return (
    <SectionWrap>
      <SectionHeader title="Layout" description="Default panels and tabs across the workspace." />
      <Card>
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
      </Card>
    </SectionWrap>
  );
}

function AISection() {
  const thinking = useIDE((s) => s.thinking);
  const toggleThinking = useIDE((s) => s.toggleThinking);
  return (
    <SectionWrap>
      <SectionHeader title="AI" description="Reasoning and generation behaviour." />
      <Card>
        <Row
          label="Thinking mode"
          hint="Show internal reasoning in chat."
          control={<Switch checked={thinking} onCheckedChange={() => toggleThinking()} />}
        />
      </Card>
    </SectionWrap>
  );
}

function ProvidersSection({
  provider,
  onOpenLogin,
  onNavigate,
}: {
  provider?: ProviderId;
  onOpenLogin: () => void;
  onNavigate: (section: SectionId, provider?: ProviderId) => void;
}) {
  if (provider) {
    const meta = PROVIDER_META[provider];
    return (
      <SectionWrap>
        <SectionHeader title={meta.label} description={meta.description} />
        <Card>
          <ProviderCard provider={provider} onOpenLogin={onOpenLogin} detailed />
        </Card>
      </SectionWrap>
    );
  }
  return (
    <SectionWrap>
      <SectionHeader
        title="Providers"
        description="One-click health checks for each CLI agent on the active remote-agent workspace."
      />
      <Card>
        {PROVIDER_IDS.map((p, i) => (
          <div key={p}>
            {i > 0 && <Separator />}
            <button
              type="button"
              onClick={() => onNavigate("providers", p)}
              className="block w-full text-left"
            >
              <ProviderCard provider={p} onOpenLogin={onOpenLogin} />
            </button>
          </div>
        ))}
      </Card>
    </SectionWrap>
  );
}

// ─── MCP Servers section ──────────────────────────────────────────────────────

/** Blank form state for "Add Server" dialog. */
type McpFormState = {
  name: string;
  scope: "global" | "workspace";
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string; // one arg per line
  envRows: { key: string; value: string }[];
  url: string;
  description: string;
};

function emptyForm(): McpFormState {
  return {
    name: "",
    scope: "global",
    transport: "stdio",
    command: "",
    args: "",
    envRows: [],
    url: "",
    description: "",
  };
}

/** Resolve the active workspace's remote-agent provider (null if not connected). */
function useActiveProvider() {
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const source = workspaces.find((w) => w.id === activeWorkspaceId)?.source;
  const [provider, setProvider] = useState<RemoteAgentProvider | null>(null);

  useEffect(() => {
    if (source?.kind !== "remote-agent") {
      setProvider(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = (await providerFor(source, source.label)) as RemoteAgentProvider;
        await p.connect();
        if (!cancelled) setProvider(p);
      } catch {
        if (!cancelled) setProvider(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return provider;
}

/**
 * McpSection — UI for installing, editing, enabling/disabling, and removing
 * MCP servers in the two agentik-managed config files:
 *   global    ~/.config/agentik/mcp.json
 *   workspace <agent-root>/.agentik/mcp.json
 *
 * Format: universal {"mcpServers":{...}} per R3 audit §2
 * (https://modelcontextprotocol.io/docs/concepts/configuration).
 */
function McpSection() {
  const provider = useActiveProvider();
  const { servers, refetch } = useMcpServers();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<McpServer | null>(null);
  const [form, setForm] = useState<McpFormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);

  function openAdd() {
    setEditTarget(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(server: McpServer) {
    setEditTarget(server);
    setForm({
      name: server.id,
      scope: server.scope === "global" || server.scope === "workspace" ? server.scope : "global",
      transport:
        server.transport === "sse" ? "sse" : server.transport === "http" ? "http" : "stdio",
      command: server.command ?? "",
      args: (server.args ?? []).join("\n"),
      envRows: Object.entries(server.env ?? {}).map(([key, value]) => ({ key, value })),
      url: server.url ?? "",
      description: server.description ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!provider) {
      toast.error("No remote-agent connected");
      return;
    }
    const nameRe = /^[a-z0-9_-]+$/;
    if (!nameRe.test(form.name)) {
      toast.error("Name must match /^[a-z0-9_-]+$/");
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      toast.error("Command is required for stdio transport");
      return;
    }
    if ((form.transport === "http" || form.transport === "sse") && !form.url.trim()) {
      toast.error("URL is required for http/sse transport");
      return;
    }

    const env: Record<string, string> = {};
    for (const row of form.envRows) {
      if (row.key.trim()) env[row.key.trim()] = row.value;
    }

    const entry: McpEntry = {
      transport: form.transport,
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.transport === "stdio"
        ? {
            command: form.command.trim(),
            args: form.args
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
            ...(Object.keys(env).length ? { env } : {}),
          }
        : { url: form.url.trim() }),
    };

    setSaving(true);
    try {
      await mcpClient.save(provider, form.scope, { [form.name]: entry });
      toast.success(`MCP server "${form.name}" saved`);
      setDialogOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !provider) return;
    const scope =
      deleteTarget.scope === "global" || deleteTarget.scope === "workspace"
        ? deleteTarget.scope
        : "global";
    try {
      await mcpClient.remove(provider, scope, deleteTarget.id);
      toast.success(`Removed "${deleteTarget.id}"`);
      setDeleteTarget(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleToggle(server: McpServer) {
    if (!provider) return;
    try {
      if (server.status === "active") {
        await mcpClient.disable(provider, server.id);
      } else {
        await mcpClient.enable(provider, server.id);
      }
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Toggle failed");
    }
  }

  const isWritable = (s: McpServer) => s.scope === "global" || s.scope === "workspace";

  /** Show env-in-workspace warning per R3 audit §3 piège #3. */
  const showEnvWarning =
    form.scope === "workspace" &&
    form.transport === "stdio" &&
    form.envRows.some((r) => r.key.trim());

  return (
    <SectionWrap>
      <div className="flex items-start justify-between">
        <SectionHeader
          title="MCP Servers"
          description="Model Context Protocol servers available to AI agents. Configured entries are written to ~/.config/agentik/mcp.json (global) or <workspace>/.agentik/mcp.json."
        />
        <Button
          size="sm"
          className="mt-1 shrink-0 gap-1.5"
          onClick={openAdd}
          disabled={!provider}
          data-testid="mcp-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Server
        </Button>
      </div>

      {!provider && (
        <div className="rounded-xl border border-border/80 bg-card px-5 py-6 text-center text-[13px] text-muted-foreground">
          Connect a remote-agent workspace to manage MCP servers.
        </div>
      )}

      {provider && servers.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/80 bg-card px-5 py-10 text-center">
          <Server className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-[13px] text-muted-foreground">No MCP servers configured yet.</p>
          <a
            href="https://modelcontextprotocol.io/docs/concepts/configuration"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[12px] text-primary underline-offset-2 hover:underline"
          >
            Learn about MCP configuration
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {provider && servers.length > 0 && (
        <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="text-[12px]">
                <TableHead className="pl-5">Name</TableHead>
                <TableHead>Transport</TableHead>
                <TableHead>Command / URL</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((server) => (
                <TableRow key={server.id} data-testid={`mcp-row-${server.id}`}>
                  <TableCell className="pl-5 font-mono text-[12.5px]">{server.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[11px]">
                      {server.transport}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate font-mono text-[12px] text-muted-foreground">
                    {server.command ?? server.url ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {server.scope === "global"
                      ? "Global"
                      : server.scope === "workspace"
                        ? "Workspace"
                        : "External"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={server.status === "active"}
                      onCheckedChange={() => void handleToggle(server)}
                      data-testid={`mcp-toggle-${server.id}`}
                    />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={!isWritable(server)}
                        onClick={() => openEdit(server)}
                        data-testid={`mcp-edit-${server.id}`}
                        title={isWritable(server) ? "Edit" : "Read-only source"}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        disabled={!isWritable(server)}
                        onClick={() => setDeleteTarget(server)}
                        data-testid={`mcp-delete-${server.id}`}
                        title={isWritable(server) ? "Delete" : "Read-only source"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Add / Edit dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit "${editTarget.id}"` : "Add MCP Server"}</DialogTitle>
            <DialogDescription>
              Entries are saved to the agentik-managed config file and merged with existing servers.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name" className="text-[12.5px]">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="mcp-name"
                placeholder="my-server"
                pattern="^[a-z0-9_-]+$"
                value={form.name}
                disabled={!!editTarget}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="font-mono text-[13px]"
                data-testid="mcp-form-name"
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, digits, - and _ only.
              </p>
            </div>

            {/* Scope */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12.5px]">Scope</Label>
              <RadioGroup
                value={form.scope}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, scope: v as "global" | "workspace" }))
                }
                className="flex gap-4"
                data-testid="mcp-form-scope"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="global" id="scope-global" />
                  <Label
                    htmlFor="scope-global"
                    className="cursor-pointer text-[12.5px] font-normal"
                  >
                    Global
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="workspace" id="scope-workspace" />
                  <Label
                    htmlFor="scope-workspace"
                    className="cursor-pointer text-[12.5px] font-normal"
                  >
                    Workspace
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Transport */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12.5px]">Transport</Label>
              <RadioGroup
                value={form.transport}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, transport: v as "stdio" | "http" | "sse" }))
                }
                className="flex gap-4"
                data-testid="mcp-form-transport"
              >
                {(["stdio", "http", "sse"] as const).map((t) => (
                  <div key={t} className="flex items-center gap-2">
                    <RadioGroupItem value={t} id={`transport-${t}`} />
                    <Label
                      htmlFor={`transport-${t}`}
                      className="cursor-pointer font-mono text-[12.5px] font-normal"
                    >
                      {t}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* stdio fields */}
            {form.transport === "stdio" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mcp-command" className="text-[12.5px]">
                    Command <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="mcp-command"
                    placeholder="npx"
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    className="font-mono text-[13px]"
                    data-testid="mcp-form-command"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mcp-args" className="text-[12.5px]">
                    Args <span className="text-muted-foreground">(one per line)</span>
                  </Label>
                  <Textarea
                    id="mcp-args"
                    placeholder={`-y\n@modelcontextprotocol/server-filesystem\n/tmp`}
                    value={form.args}
                    onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                    rows={3}
                    className="resize-none font-mono text-[12px]"
                    data-testid="mcp-form-args"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12.5px]">Env vars</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px]"
                      onClick={() =>
                        setForm((f) => ({ ...f, envRows: [...f.envRows, { key: "", value: "" }] }))
                      }
                    >
                      <Plus className="h-3 w-3" />
                      Add env var
                    </Button>
                  </div>
                  {form.envRows.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder="KEY"
                        value={row.key}
                        onChange={(e) =>
                          setForm((f) => {
                            const next = [...f.envRows];
                            next[i] = { ...next[i], key: e.target.value };
                            return { ...f, envRows: next };
                          })
                        }
                        className="w-1/2 font-mono text-[12px]"
                      />
                      <Input
                        placeholder="value"
                        value={row.value}
                        onChange={(e) =>
                          setForm((f) => {
                            const next = [...f.envRows];
                            next[i] = { ...next[i], value: e.target.value };
                            return { ...f, envRows: next };
                          })
                        }
                        className="w-1/2 font-mono text-[12px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground"
                        onClick={() =>
                          setForm((f) => ({ ...f, envRows: f.envRows.filter((_, j) => j !== i) }))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {/* R3 audit §3 piège #3 — env in workspace scope may be committed */}
                  {showEnvWarning && (
                    <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-[11.5px] text-yellow-700 dark:text-yellow-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Env vars in workspace scope may be committed to git. Use{" "}
                        <strong>Global</strong> scope for secrets.
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* http / sse fields */}
            {(form.transport === "http" || form.transport === "sse") && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-url" className="text-[12.5px]">
                  URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mcp-url"
                  type="url"
                  placeholder="https://example.com/mcp"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  className="font-mono text-[13px]"
                  data-testid="mcp-form-url"
                />
              </div>
            )}

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-description" className="text-[12.5px]">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="mcp-description"
                placeholder="What does this server do?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="text-[13px]"
                data-testid="mcp-form-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving} data-testid="mcp-form-save">
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.id}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the entry from the{" "}
              {deleteTarget?.scope === "global" ? "global" : "workspace"} agentik config file. Other
              config sources (Claude Desktop, Cursor, etc.) are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
              data-testid="mcp-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionWrap>
  );
}
