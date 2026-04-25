import { useEffect, useState } from "react";
import { useIDE } from "@/store/ide";

export type AgentHealth =
  | { kind: "none" }
  | { kind: "checking"; url: string }
  | { kind: "online"; url: string; latencyMs: number }
  | { kind: "offline"; url: string; error: string };

const POLL_MS = 5_000;
const TIMEOUT_MS = 2_500;

function wsToHttp(url: string): string {
  return url.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
}

/**
 * Polls the active workspace's remote agent over HTTP GET / every 5s.
 * Returns `none` when the active workspace is not a remote-agent.
 */
export function useAgentHealth(): AgentHealth {
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const source = workspaces.find((w) => w.id === activeWorkspaceId)?.source;
  const url = source?.kind === "remote-agent" ? source.url : undefined;

  const [health, setHealth] = useState<AgentHealth>(
    url ? { kind: "checking", url } : { kind: "none" },
  );

  useEffect(() => {
    if (!url) {
      setHealth({ kind: "none" });
      return;
    }
    let cancelled = false;
    const probeUrl = wsToHttp(url);

    const probe = async () => {
      const started = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(probeUrl, { signal: ctrl.signal });
        if (cancelled) return;
        if (!res.ok) {
          setHealth({ kind: "offline", url, error: `HTTP ${res.status}` });
          return;
        }
        const latencyMs = Math.round(performance.now() - started);
        setHealth({ kind: "online", url, latencyMs });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "unreachable";
        setHealth({ kind: "offline", url, error: msg });
      } finally {
        clearTimeout(timer);
      }
    };

    setHealth({ kind: "checking", url });
    void probe();
    const interval = setInterval(probe, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [url]);

  return health;
}
