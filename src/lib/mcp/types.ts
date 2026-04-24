export type McpServer = {
  id: string;
  transport: "stdio" | "http" | "ws";
  command?: string;
  url?: string;
  status: "configured" | "installed" | "active" | "error";
  source: string;
  description?: string;
};

export type McpState = {
  enabled: string[];
};
