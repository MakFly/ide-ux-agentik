import type { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import type { McpServer, McpState } from "./types.js";

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
};
