import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useIDE, useCurrentScopeKey, useCurrentWorktree, type ScopeKey } from "@/store/ide";

/**
 * xterm.js must stay client-only — it touches DOM at import time and the
 * SSR runtime (tanstack-start) chokes on its CJS/ESM dual shipping.
 * Everything is wired through a dynamic import inside an effect.
 */

function prompt(scope: ScopeKey, worktreePath?: string): string {
  const [ws, br] = scope.split(":");
  const suffix = worktreePath ? ` \x1b[90m(${worktreePath.split("/").pop()})\x1b[0m` : "";
  return `\x1b[36m${ws}\x1b[0m:\x1b[33m${br}\x1b[0m${suffix}$ `;
}

function runCommand(line: string, term: XtermLike, scope: ScopeKey, worktreePath?: string) {
  const [cmd, ...args] = line.split(/\s+/);
  switch (cmd) {
    case "help":
      term.writeln("Available: help, ls, clear, echo, pwd, whoami, date, scope");
      break;
    case "ls":
      term.writeln("src  package.json  README.md  node_modules  dist");
      break;
    case "clear":
      term.clear();
      break;
    case "pwd":
      term.writeln(worktreePath ?? `/workspaces/${scope.split(":")[0]}`);
      break;
    case "whoami":
      term.writeln("agent");
      break;
    case "date":
      term.writeln(new Date().toString());
      break;
    case "scope":
      term.writeln(`workspace:branch → ${scope}`);
      if (worktreePath) term.writeln(`worktree:path → ${worktreePath}`);
      break;
    case "echo":
      term.writeln(args.join(" "));
      break;
    default:
      term.writeln(`\x1b[31m${cmd}: command not found\x1b[0m`);
  }
}

type XtermLike = {
  open(el: HTMLElement): void;
  focus(): void;
  write(d: string): void;
  writeln(d: string): void;
  clear(): void;
  onData(cb: (d: string) => void): void;
  loadAddon(a: unknown): void;
  dispose(): void;
};
type FitLike = { fit(): void };

const xtermModulesPromise = Promise.all([
  import("@xterm/xterm"),
  import("@xterm/addon-fit"),
  import("@xterm/addon-web-links"),
  import("@xterm/xterm/css/xterm.css"),
]);

export function TerminalPanel() {
  const scope = useCurrentScopeKey();
  const currentWorktree = useCurrentWorktree();
  const worktreePath = currentWorktree?.path;
  const worktreeName = currentWorktree?.name;
  const toggleTerminal = useIDE((s) => s.toggleTerminal);
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    let term: XtermLike | null = null;

    (async () => {
      const host = hostRef.current;
      if (!host) return;
      setReady(false);
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await xtermModulesPromise;
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
        scrollback: 2000,
        allowTransparency: true,
      }) as unknown as XtermLike;
      const fit = new FitAddon() as unknown as FitLike;
      term = instance;
      let input = "";

      instance.loadAddon(fit);
      instance.loadAddon(new WebLinksAddon());
      host.replaceChildren();
      instance.open(host);
      instance.writeln(`\x1b[90m# terminal — scope ${scope}\x1b[0m`);
      if (worktreePath) {
        instance.writeln(`\x1b[90m# attached worktree — ${worktreePath}\x1b[0m`);
      }
      instance.writeln("\x1b[90m# mock shell — try `help`, `ls`, `clear`, `echo`\x1b[0m");
      instance.write(prompt(scope, worktreePath));

      instance.onData((data) => {
        const code = data.charCodeAt(0);
        if (data === "\r") {
          const line = input.trim();
          instance.write("\r\n");
          if (line) {
            runCommand(line, instance, scope, worktreePath);
          }
          input = "";
          instance.write(prompt(scope, worktreePath));
        } else if (code === 127) {
          if (input.length > 0) {
            input = input.slice(0, -1);
            instance.write("\b \b");
          }
        } else if (code === 3) {
          instance.write("^C\r\n");
          input = "";
          instance.write(prompt(scope, worktreePath));
        } else if (code >= 32) {
          input += data;
          instance.write(data);
        }
      });

      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      instance.focus();
      setReady(true);

      ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
      ro.observe(host);
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      term?.dispose();
    };
  }, [scope, worktreePath]);

  return (
    <div className="flex h-[240px] shrink-0 flex-col border-t border-border bg-black">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">
          terminal · {scope}
          {worktreeName ? ` · ${worktreeName}` : ""}
        </span>
        <button
          onClick={toggleTerminal}
          className="rounded p-1 hover:bg-accent hover:text-foreground"
          title="Close terminal"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden px-2 py-1">
        <div ref={hostRef} className="h-full w-full" />
        {!ready && (
          <div className="pointer-events-none absolute inset-0 px-3 py-2 text-[11px] text-muted-foreground">
            loading terminal…
          </div>
        )}
      </div>
    </div>
  );
}
