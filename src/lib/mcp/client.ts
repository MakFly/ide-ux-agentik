import type { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import type { McpEntry, McpServer, McpState } from "./types.js";

function rpc<T>(provider: RemoteAgentProvider, method: string, params?: unknown): Promise<T> {
  return provider.call<T>(method, params);
}

export const mcpClient = {
  list(provider: RemoteAgentProvider): Promise<McpServer[]> {
    return rpc<McpServer[]>(provider, "mcp.list", {});
  },
  state(provider: RemoteAgentProvider): Promise<McpState> {
    return rpc<McpState>(provider, "mcp.state", {});
  },
  enable(provider: RemoteAgentProvider, id: string): Promise<{ ok: true; enabled: string[] }> {
    return rpc(provider, "mcp.enable", { id });
  },
  disable(provider: RemoteAgentProvider, id: string): Promise<{ ok: true; enabled: string[] }> {
    return rpc(provider, "mcp.disable", { id });
  },
  /**
   * Write one or more MCP entries to the agentik-managed config file.
   * scope "global"    → ~/.config/agentik/mcp.json
   * scope "workspace" → <agent-root>/.agentik/mcp.json
   */
  save(
    provider: RemoteAgentProvider,
    scope: "global" | "workspace",
    entries: Record<string, McpEntry>,
  ): Promise<{ ok: true; path: string }> {
    return rpc(provider, "mcp.save", { scope, entries });
  },
  /** Remove a single MCP entry from the agentik-managed config file. */
  remove(
    provider: RemoteAgentProvider,
    scope: "global" | "workspace",
    id: string,
  ): Promise<{ ok: true; path: string }> {
    return rpc(provider, "mcp.remove", { scope, id });
  },
};
