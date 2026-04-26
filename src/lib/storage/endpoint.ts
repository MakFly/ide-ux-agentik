/**
 * Agent endpoint resolution — ZERO localStorage.
 *
 * The endpoint (URL + token) is read at runtime from build-time env vars
 * injected by `scripts/dev.ts` (VITE_DEV_AGENT_URL/TOKEN). Nothing is ever
 * written to the browser. The single source of truth for application data
 * (orgs, users, workspaces, sessions, tasks, messages) is the agent SQLite.
 *
 * Production deployment will surface the endpoint via a different channel
 * (cookie set by the agent serving the bundle, or `window.__AGENT__` injected
 * at SSR/edge); this module is the single seam to swap when that happens.
 */

export type AgentEndpoint = {
  url: string;
  token: string;
  label: string;
};

export function getEndpoint(): AgentEndpoint | null {
  if (typeof window === "undefined") return null;

  // Build-time injection — the only path in dev.
  const url = import.meta.env.VITE_DEV_AGENT_URL as string | undefined;
  const token = import.meta.env.VITE_DEV_AGENT_TOKEN as string | undefined;
  if (url && token) {
    return { url, token, label: "local-dev" };
  }

  // Optional runtime injection (e.g. SSR / agent-served bundle).
  const injected = (window as unknown as { __AGENT__?: AgentEndpoint }).__AGENT__;
  if (injected?.url && injected?.token) {
    return { ...injected, label: injected.label ?? "agent" };
  }

  return null;
}

/** Kept as a no-op so existing call sites compile; localStorage is no longer used. */
export function setEndpoint(_endpoint: AgentEndpoint): void {
  /* intentionally empty — endpoint comes from build/runtime injection */
}

/** Kept as a no-op for parity with the old API. */
export function clearEndpoint(): void {
  /* intentionally empty */
}
