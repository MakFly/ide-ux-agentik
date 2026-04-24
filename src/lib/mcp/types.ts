export type McpServer = {
  id: string;
  transport: "stdio" | "http" | "ws" | "sse";
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  status: "configured" | "installed" | "active" | "error";
  source: string;
  /** "agentik-global" | "agentik-workspace" | path to source file */
  scope?: "global" | "workspace" | string;
  description?: string;
};

export type McpState = {
  enabled: string[];
};

/**
 * Canonical MCP entry written to ~/.config/agentik/mcp.json (global) or
 * <cwd>/.agentik/mcp.json (workspace).
 *
 * Format follows the universal {"mcpServers":{...}} schema shared by
 * Cursor, Claude Desktop, and Claude Code — see R3 audit §2
 * (https://modelcontextprotocol.io/docs/concepts/configuration).
 */
export type McpEntry = {
  /** stdio transport: path or name of the executable */
  command?: string;
  /** stdio transport: argument list */
  args?: string[];
  /** stdio transport: additional env vars (secrets → use global scope) */
  env?: Record<string, string>;
  /** http / sse transport: server URL */
  url?: string;
  /** Explicit transport override; inferred from url/command when absent */
  transport?: "stdio" | "http" | "sse";
  /** Human-readable description shown in the UI */
  description?: string;
};
