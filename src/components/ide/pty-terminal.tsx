import { useEffect, useRef, useState } from "react";
import { useIDE } from "@/store/ide";
import { RemoteAgentProvider, type PtyHandle } from "@/lib/fs/remote-agent";
import { NoAgentBanner } from "@/components/ide/no-agent-banner";

/**
 * Reusable xterm + PTY pipe. Client-only — xterm touches DOM at import time,
 * so modules are dynamically imported inside an effect.
 *
 * Renders a mock shell if the active workspace is not a remote-agent (PTY is
 * only possible on an agent host with node-pty).
 */

type XtermLike = {
  open(el: HTMLElement): void;
  focus(): void;
  write(d: string): void;
  writeln(d: string): void;
  clear(): void;
  onData(cb: (d: string) => void): { dispose(): void } | void;
  loadAddon(a: unknown): void;
  dispose(): void;
  cols: number;
  rows: number;
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
  attachCustomKeyEventHandler(h: (e: KeyboardEvent) => boolean): void;
  paste(data: string): void;
};
type FitLike = { fit(): void };

const xtermModulesPromise = () =>
  Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
    import("@xterm/xterm/css/xterm.css"),
  ]);

export type PtyTerminalProps = {
  /** Optional command to spawn. If omitted, agent spawns the default login shell. */
  cmd?: string;
  args?: string[];
  /** Extra env injected into the spawned process. Merged with codex injection. */
  extraEnv?: Record<string, string>;
  /** When true, write `.codex-home/auth.json` and set CODEX_HOME before spawn. */
  injectCodexAuth?: boolean;
  /** When true, inject OPENAI_API_KEY from the store. */
  injectCodexApiKey?: boolean;
  /** Banner lines printed before the PTY pipes in. */
  banner?: string[];
  className?: string;
  /** Re-spawn when this key changes (e.g. session id). */
  resetKey?: string;
};

export function PtyTerminal({
  cmd,
  args,
  extraEnv,
  injectCodexAuth,
  injectCodexApiKey,
  banner,
  className,
  resetKey,
}: PtyTerminalProps) {
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const codexApiKey = useIDE((s) => s.codexApiKey);
  const codexAuth = useIDE((s) => s.codexAuth);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XtermLike | null>(null);
  const [ready, setReady] = useState(false);

  const source = workspaces.find((w) => w.id === activeWorkspaceId)?.source;
  const isRemote = source?.kind === "remote-agent";

  useEffect(() => {
    // Skip xterm mount when there's no agent — the NoAgentBanner takes over.
    if (!isRemote) {
      setReady(true);
      return;
    }
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    let term: XtermLike | null = null;
    let ptyHandle: PtyHandle | null = null;
    let provider: RemoteAgentProvider | null = null;

    (async () => {
      const host = hostRef.current;
      if (!host) return;
      setReady(false);
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await xtermModulesPromise();
      if (cancelled) return;

      const instance = new Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12.5,
        lineHeight: 1.3,
        theme: {
          background: "#000000",
          foreground: "#e6e6e6",
          cursor: "#e6e6e6",
          selectionBackground: "#3a3f4b",
        },
        scrollback: 4000,
        allowTransparency: true,
      }) as unknown as XtermLike;
      const fit = new FitAddon() as unknown as FitLike;
      term = instance;
      termRef.current = instance;

      // Clipboard bindings: Ctrl+Shift+C copies selection, Ctrl+Shift+V pastes.
      // Returning `false` from the handler tells xterm to skip its default
      // action (so the browser's clipboard API takes over).
      instance.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        const ctrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey;
        if (ctrlShift && e.code === "KeyC") {
          if (instance.hasSelection()) {
            void navigator.clipboard.writeText(instance.getSelection()).catch(() => {});
          }
          return false;
        }
        if (ctrlShift && e.code === "KeyV") {
          void navigator.clipboard
            .readText()
            .then((txt) => {
              if (txt) instance.paste(txt);
            })
            .catch(() => {});
          return false;
        }
        return true;
      });

      instance.loadAddon(fit);
      instance.loadAddon(new WebLinksAddon());
      host.replaceChildren();
      instance.open(host);
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      instance.focus();

      for (const line of banner ?? []) instance.writeln(line);

      if (!source || source.kind !== "remote-agent") {
        // Guarded above, should not reach here.
        return;
      }
      provider = new RemoteAgentProvider(source.label, source.url, source.token);
      try {
        await provider.connect();
      } catch (e) {
        instance.writeln(
          `\x1b[31m[agent connection failed: ${e instanceof Error ? e.message : String(e)}]\x1b[0m`,
        );
        setReady(true);
        return;
      }
      if (cancelled) {
        void provider.disconnect();
        return;
      }

      const env: Record<string, string> = { ...(extraEnv ?? {}) };
      if (injectCodexApiKey && codexApiKey) env.OPENAI_API_KEY = codexApiKey;
      if (injectCodexAuth && codexAuth) {
        const ageMs = Date.now() - new Date(codexAuth.lastRefresh).getTime();
        if (ageMs > 12 * 60 * 60 * 1000) {
          await useIDE.getState().refreshCodexTokens();
        }
        const fresh = useIDE.getState().codexAuth ?? codexAuth;
        try {
          const { buildAuthDotJson } = await import("@/lib/codex-auth");
          await provider.mkdir(".codex-home").catch(() => {});
          await provider.writeFile(
            ".codex-home/auth.json",
            buildAuthDotJson({
              idToken: fresh.idToken,
              accessToken: fresh.accessToken,
              refreshToken: fresh.refreshToken,
            }),
          );
          env.CODEX_HOME = ".codex-home";
        } catch (err) {
          instance.writeln(
            `\x1b[33m[codex auth.json write failed: ${err instanceof Error ? err.message : String(err)}]\x1b[0m`,
          );
        }
      }

      try {
        // cwd omitted on purpose: agent defaults to its --root (= the project
        // folder). Our in-store worktree.path is mock-seeded and would be
        // clamped anyway.
        ptyHandle = await provider.ptySpawn({
          cmd,
          args,
          cols: instance.cols,
          rows: instance.rows,
          env,
        });
      } catch (e) {
        instance.writeln(
          `\x1b[31m[PTY spawn failed: ${e instanceof Error ? e.message : String(e)}]\x1b[0m`,
        );
        setReady(true);
        return;
      }
      if (cancelled) {
        ptyHandle.kill();
        void provider.disconnect();
        return;
      }

      instance.onData((data) => ptyHandle?.write(data));
      ptyHandle.onData((data) => instance.write(data));
      ptyHandle.onExit((code, signal) => {
        instance.writeln(
          `\x1b[90m[exited code=${code ?? "null"} signal=${signal ?? "null"}]\x1b[0m`,
        );
      });

      setReady(true);
      ro = new ResizeObserver(() => {
        try {
          fit.fit();
          ptyHandle?.resize(instance.cols, instance.rows);
        } catch {
          /* ignore */
        }
      });
      ro.observe(host);
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      ptyHandle?.kill();
      term?.dispose();
      termRef.current = null;
      void provider?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeWorkspaceId,
    cmd,
    JSON.stringify(args),
    resetKey,
    codexAuth,
    codexApiKey,
    JSON.stringify(extraEnv ?? {}),
    injectCodexAuth,
    injectCodexApiKey,
    // `banner` is intentionally NOT a dep: it's written once at boot and a
    // re-spawn just to display new boot text would tear down the active PTY.
  ]);

  if (!isRemote) {
    return (
      <div className={`relative h-full w-full ${className ?? ""}`}>
        <NoAgentBanner cmd={cmd} />
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full bg-black ${className ?? ""}`}>
      <div
        ref={hostRef}
        className="h-full w-full px-2 py-1"
        onContextMenu={(e) => {
          // Right-click paste — works without leaving the PTY focus.
          if (e.shiftKey) return; // Shift+right-click → browser native menu
          e.preventDefault();
          void navigator.clipboard
            .readText()
            .then((txt) => {
              if (txt) termRef.current?.paste(txt);
            })
            .catch(() => {});
        }}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 px-3 py-2 text-[11px] text-muted-foreground">
          loading terminal…
        </div>
      )}
    </div>
  );
}
