import { useEffect, useRef, useState } from "react";
import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { useIDE } from "@/store/ide";
import { skillsList } from "./client";
import type { Skill } from "./types";

export type { Skill } from "./types";

const REVALIDATE_MS = 30_000;

function getActiveRemoteAgentSource() {
  const { workspaces, activeWorkspaceId } = useIDE.getState();
  const ws = workspaces.find((w) => w.id === activeWorkspaceId);
  if (ws?.source.kind !== "remote-agent") return null;
  return ws.source;
}

export function useSkills(): Skill[] {
  const [skills, setSkills] = useState<Skill[]>([]);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const workspaces = useIDE((s) => s.workspaces);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetch = async () => {
      const source = getActiveRemoteAgentSource();

      const agentSkills: Skill[] = await (async () => {
        if (!source) return [];
        try {
          const provider = (await providerFor(source, source.label)) as RemoteAgentProvider;
          await provider.connect();
          return await skillsList(provider);
        } catch {
          return [];
        }
      })();

      // A10 mcp.list — optional, fallback [] if not yet available.
      const mcpSkills: Skill[] = await (async () => {
        if (!source) return [];
        try {
          const provider = (await providerFor(source, source.label)) as RemoteAgentProvider;
          const raw = await provider.call<{ id: string; name: string; description?: string }[]>(
            "mcp.list",
            {},
          );
          return raw.map((m) => ({
            id: `mcp:${m.id}`,
            name: m.name,
            description: m.description,
            kind: "mcp" as const,
            source: "mcp" as const,
          }));
        } catch {
          return [];
        }
      })();

      if (cancelled) return;

      // Merge, deduplicate by id (agent skills take precedence over mcp on collision).
      const seen = new Set<string>();
      const merged: Skill[] = [];
      for (const s of [...agentSkills, ...mcpSkills]) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          merged.push(s);
        }
      }

      setSkills(merged);

      if (!cancelled) {
        timerRef.current = setTimeout(fetch, REVALIDATE_MS);
      }
    };

    void fetch();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, workspaces]);

  return skills;
}
