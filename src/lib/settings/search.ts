import { z } from "zod";

export const SETTINGS_SECTION_IDS = [
  "agent",
  "organization",
  "workspace",
  "appearance",
  "layout",
  "ai",
  "providers",
  "mcp",
] as const;

export const SETTINGS_PROVIDER_IDS = ["codex", "claude", "opencode", "gemini"] as const;

export const settingsSearchSchema = z.object({
  login: z.enum(["codex"]).optional(),
  section: z.enum(SETTINGS_SECTION_IDS).optional(),
  provider: z.enum(SETTINGS_PROVIDER_IDS).optional(),
});

export type SettingsSearch = z.infer<typeof settingsSearchSchema>;
