import type { Org, User } from "../types/org";
import type { Workspace } from "../../store/ide";
import type { StorageAdapter, Snapshot } from "./types";

const VERSION = "v1";

const KEYS = {
  org: `ide.org.${VERSION}`,
  user: `ide.user.${VERSION}`,
  workspaces: (orgId: string) => `ide.ws.${orgId}.${VERSION}`,
};

export class LocalStorageAdapter implements StorageAdapter {
  async getOrg(): Promise<Org | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEYS.org);
    return raw ? JSON.parse(raw) : null;
  }

  async putOrg(org: Org): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEYS.org, JSON.stringify(org));
  }

  async getUser(): Promise<User | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEYS.user);
    return raw ? JSON.parse(raw) : null;
  }

  async putUser(user: User): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEYS.user, JSON.stringify(user));
  }

  async getWorkspaces(orgId: string): Promise<Workspace[]> {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(KEYS.workspaces(orgId));
    return raw ? JSON.parse(raw) : [];
  }

  async putWorkspace(orgId: string, workspace: Workspace): Promise<void> {
    if (typeof window === "undefined") return;
    const key = KEYS.workspaces(orgId);
    const existing = await this.getWorkspaces(orgId);
    const filtered = existing.filter((ws) => ws.id !== workspace.id);
    const updated = [...filtered, workspace];
    window.localStorage.setItem(key, JSON.stringify(updated));
  }

  async removeWorkspace(orgId: string, wsId: string): Promise<void> {
    if (typeof window === "undefined") return;
    const key = KEYS.workspaces(orgId);
    const existing = await this.getWorkspaces(orgId);
    const filtered = existing.filter((ws) => ws.id !== wsId);
    if (filtered.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(filtered));
    }
  }

  async exportAll(): Promise<Snapshot> {
    const org = await this.getOrg();
    const user = await this.getUser();
    const workspacesByOrgId: Record<string, Workspace[]> = {};
    if (org) {
      workspacesByOrgId[org.id] = await this.getWorkspaces(org.id);
    }
    return {
      version: VERSION,
      org,
      user,
      workspacesByOrgId,
    };
  }

  async importAll(snapshot: Snapshot): Promise<void> {
    if (snapshot.org) {
      await this.putOrg(snapshot.org);
      const workspaces = snapshot.workspacesByOrgId[snapshot.org.id] || [];
      for (const ws of workspaces) {
        await this.putWorkspace(snapshot.org.id, ws);
      }
    }
    if (snapshot.user) {
      await this.putUser(snapshot.user);
    }
  }
}
