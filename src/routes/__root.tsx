import { useEffect } from "react";
import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { useIDE, type TerminalKind } from "@/store/ide";
import { autoRegisterDevAgent } from "@/lib/dev-bootstrap";
import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { persistence } from "@/lib/persistence/client";

const themeBootstrapScript = `
(() => {
  const storedTheme = window.localStorage.getItem("ide-theme");
  const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
})();
`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Superconductor — GPU-accelerated IDE for AI agents" },
      {
        name: "description",
        content:
          "Manage git worktrees and run AI coding agents in per-worktree terminal sessions. Native macOS, written in Rust, rendered via Metal.",
      },
      { name: "author", content: "Superconductor" },
      { property: "og:title", content: "Superconductor — IDE for AI agents" },
      {
        property: "og:description",
        content:
          "GPU-accelerated macOS desktop app for managing git worktrees and running AI coding agents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function ThemeController() {
  const theme = useIDE((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const isDark = theme === "dark";

    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
  }, [theme]);

  return null;
}

function RootComponent() {
  const theme = useIDE((s) => s.theme);
  const hydrate = useIDE((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    // Auto-register the local dev agent workspace when VITE_DEV_AGENT_* are injected.
    void autoRegisterDevAgent();
    // If Codex auth is older than 23h, silently refresh it in the background.
    const s = useIDE.getState();
    if (s.codexAuth) {
      const ageMs = Date.now() - new Date(s.codexAuth.lastRefresh).getTime();
      if (ageMs > 23 * 60 * 60 * 1000) {
        void s.refreshCodexTokens();
      }
    }
    // Dev-only testing handle for Playwright. No-op in production builds.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as unknown as { __ideStore?: unknown }).__ideStore = {
        addWorkspace: (name: string, source: unknown) =>
          useIDE
            .getState()
            .addWorkspace(
              name,
              source as Parameters<ReturnType<typeof useIDE.getState>["addWorkspace"]>[1],
            ),
        setActiveWorkspace: (id: string) => useIDE.getState().setActiveWorkspace(id),
        get workspaces() {
          return useIDE.getState().workspaces;
        },
        /** Create a new agent session in the active workspace and return its id. */
        addAgentSession: (kind: TerminalKind) => {
          useIDE.getState().addAgentSession(kind);
          const s = useIDE.getState();
          return s.activeSessionIdByWorkspaceId[s.activeWorkspaceId];
        },
        /** Read the active session id for a given workspace. */
        getActiveSessionId: (workspaceId: string) =>
          useIDE.getState().activeSessionIdByWorkspaceId[workspaceId],
        /** Seed the DB with N fake assistant/user messages for a given session. */
        seedMessages: async (sessionId: string, count: number) => {
          const s = useIDE.getState();
          const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
          if (!ws || ws.source.kind !== "remote-agent") {
            throw new Error("seedMessages: active workspace is not remote-agent");
          }
          const provider = (await providerFor(ws.source, ws.source.label)) as RemoteAgentProvider;
          await provider.connect();
          await persistence.sessions.create(provider, {
            id: sessionId,
            workspaceId: ws.id,
            cli: "codex",
            title: "e2e seed session",
          });
          for (let i = 0; i < count; i++) {
            await persistence.messages.append(provider, {
              sessionId,
              role: i % 2 === 0 ? "user" : "assistant",
              parts: [{ type: "text", text: `seed message ${i}` }],
            });
          }
        },
        /** List persisted messages for a session via the remote-agent RPC. */
        listMessages: async (sessionId: string) => {
          const s = useIDE.getState();
          const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
          if (!ws || ws.source.kind !== "remote-agent") return [];
          const provider = (await providerFor(ws.source, ws.source.label)) as RemoteAgentProvider;
          await provider.connect();
          return persistence.messages.list(provider, sessionId);
        },
      };
    }
  }, [hydrate]);

  return (
    <>
      <ThemeController />
      <Outlet />
      <Toaster position="bottom-right" theme={theme} />
    </>
  );
}
