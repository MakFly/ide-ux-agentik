import { getStorage } from "./index";
import type { Org, User } from "../types/org";
import type { Workspace } from "../../store/ide";

export async function migrateLegacyStore(): Promise<{ migrated: boolean; workspaceCount: number }> {
  if (typeof window === "undefined") {
    return { migrated: false, workspaceCount: 0 };
  }

  const storage = getStorage();
  const existingOrg = await storage.getOrg();
  if (existingOrg) {
    return { migrated: false, workspaceCount: 0 };
  }

  const legacyJson = window.localStorage.getItem("ide-ux-agentik");
  if (!legacyJson) {
    return { migrated: false, workspaceCount: 0 };
  }

  let legacyState: unknown;
  try {
    legacyState = JSON.parse(legacyJson);
  } catch {
    return { migrated: false, workspaceCount: 0 };
  }

  const state = legacyState as { state?: { workspaces?: unknown[] } } | undefined;
  const workspaces = (state?.state?.workspaces ?? []) as Array<Workspace & { orgId?: string }>;

  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return { migrated: false, workspaceCount: 0 };
  }

  const orgId = crypto.randomUUID?.() || generateId();
  const org: Org = {
    id: orgId,
    name: "Personal",
    slug: "personal",
    createdAt: Date.now(),
  };

  const user: User = {
    id: crypto.randomUUID?.() || generateId(),
    displayName: "You",
    defaultAgent: "claude",
  };

  await storage.putOrg(org);
  await storage.putUser(user);

  for (const ws of workspaces) {
    const migratedWs: Workspace = {
      ...ws,
      orgId,
    };
    await storage.putWorkspace(orgId, migratedWs);
  }

  window.localStorage.removeItem("ide-ux-agentik");

  return { migrated: true, workspaceCount: workspaces.length };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
