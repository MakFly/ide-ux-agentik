import { useCallback, useEffect, useRef, useState } from "react";
import { useIDE } from "@/store/ide";
import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { mcpClient } from "./client.js";
import type { McpServer } from "./types.js";

const POLL_MS = 30_000;

export type UseMcpServersResult = {
  servers: McpServer[];
  /** Immediately re-fetches the server list (e.g. after save/remove/enable/disable). */
  refetch: () => void;
};

export function useMcpServers(): UseMcpServersResult {
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const source = workspaces.find((w) => w.id === activeWorkspaceId)?.source;

  const [servers, setServers] = useState<McpServer[]>([]);
  // Bump this counter to trigger an immediate refetch.
  const [version, setVersion] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (source?.kind !== "remote-agent") {
      setServers([]);
      return;
    }

    let cancelled = false;

    const fetch = async () => {
      try {
        const provider = (await providerFor(source, source.label)) as RemoteAgentProvider;
        await provider.connect();
        const [list, state] = await Promise.all([
          mcpClient.list(provider),
          mcpClient.state(provider),
        ]);
        if (cancelled) return;
        const enabledSet = new Set(state.enabled);
        setServers(
          list.map((s) => (enabledSet.has(s.id) ? { ...s, status: "active" as const } : s)),
        );
      } catch {
        if (!cancelled) setServers([]);
      }
    };

    void fetch();
    timerRef.current = setInterval(() => void fetch(), POLL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // version is intentionally included: bumping it re-runs this effect → immediate re-fetch.
  }, [source, version]);

  return { servers, refetch };
}
