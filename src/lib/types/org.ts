export type Org = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  createdAt: number;
};

export type User = {
  id: string;
  displayName: string;
  email?: string;
  defaultAgent: "codex" | "claude" | "opencode" | "gemini";
};
