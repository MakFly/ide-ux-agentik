export type Skill = {
  id: string;
  name: string;
  description?: string;
  kind: "personal" | "system" | "mcp";
  iconUrl?: string;
  source?: "codex" | "plugin" | "mcp";
};
