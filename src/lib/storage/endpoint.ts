/**
 * Agent endpoint resolution.
 *
 * The endpoint can be overridden from /settings so auth can be fixed without
 * rebuilding the app. App data still lives on the agent SQLite; this small
 * browser-side record only stores the connection coordinates needed to reach it.
 *
 * Fallback order:
 *   1. User override saved from /settings.
 *   2. Runtime-injected window.__AGENT__.
 *   3. Build-time VITE_DEV_AGENT_URL/TOKEN.
 */

export type AgentEndpoint = {
  url: string;
  token: string;
  label: string;
};

const STORAGE_KEY = "agentik.global-agent.endpoint.v1";

function readStoredEndpoint(): AgentEndpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentEndpoint>;
    if (!parsed.url || !parsed.token) return null;
    return {
      url: parsed.url,
      token: parsed.token,
      label: parsed.label || "agent",
    };
  } catch {
    return null;
  }
}

function readInjectedEndpoint(): AgentEndpoint | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { __AGENT__?: AgentEndpoint }).__AGENT__;
  if (!injected?.url || !injected?.token) return null;
  return { ...injected, label: injected.label ?? "agent" };
}

function readEnvEndpoint(): AgentEndpoint | null {
  const url = import.meta.env.VITE_DEV_AGENT_URL as string | undefined;
  const token = import.meta.env.VITE_DEV_AGENT_TOKEN as string | undefined;
  if (!url || !token) return null;
  return { url, token, label: "local-dev" };
}

function readRuntimeEndpoint(): { endpoint: AgentEndpoint; source: "injected" | "env" } | null {
  const injected = readInjectedEndpoint();
  if (injected) return { endpoint: injected, source: "injected" };

  const env = readEnvEndpoint();
  if (env) return { endpoint: env, source: "env" };

  return null;
}

function shouldPreferRuntimeEndpoint(
  stored: AgentEndpoint | null,
  runtime: AgentEndpoint | null,
): boolean {
  if (!stored || !runtime) return false;
  return stored.label === "local-dev" && stored.url === runtime.url;
}

export function getEndpoint(): AgentEndpoint | null {
  if (typeof window === "undefined") return null;

  const stored = readStoredEndpoint();
  const runtime = readRuntimeEndpoint();
  if (shouldPreferRuntimeEndpoint(stored, runtime?.endpoint ?? null)) {
    return runtime!.endpoint;
  }
  if (stored) return stored;
  if (runtime) return runtime.endpoint;

  return null;
}

export function setEndpoint(endpoint: AgentEndpoint): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      url: endpoint.url,
      token: endpoint.token,
      label: endpoint.label || "agent",
    }),
  );
}

export function clearEndpoint(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getEndpointSource(): "saved" | "injected" | "env" | "none" {
  if (typeof window === "undefined") return "none";
  const stored = readStoredEndpoint();
  const runtime = readRuntimeEndpoint();
  if (shouldPreferRuntimeEndpoint(stored, runtime?.endpoint ?? null)) {
    return runtime!.source;
  }
  if (stored) return "saved";
  if (runtime) return runtime.source;
  return "none";
}
