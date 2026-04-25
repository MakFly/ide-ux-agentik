/**
 * Agent endpoint credentials — the ONLY thing the client persists locally.
 * This is connection metadata, not application data: it tells the client
 * which agent (URL+token) to talk to so it can pull everything else from the
 * server SQLite (single source of truth).
 *
 * Anything else that used to live in localStorage (org, user, workspaces,
 * sessions, tasks, messages) now lives on the agent.
 */

const KEY = "ide.agent.endpoint";

export type AgentEndpoint = {
  url: string;
  token: string;
  label: string;
};

export function getEndpoint(): AgentEndpoint | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentEndpoint>;
    if (!parsed.url || !parsed.token) return null;
    return { url: parsed.url, token: parsed.token, label: parsed.label ?? "agent" };
  } catch {
    return null;
  }
}

export function setEndpoint(endpoint: AgentEndpoint): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(endpoint));
}

export function clearEndpoint(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
