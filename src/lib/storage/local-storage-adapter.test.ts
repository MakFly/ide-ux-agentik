// @ts-ignore bun:test is Bun's native test API
import { describe, it, expect, beforeEach } from "bun:test";
import { LocalStorageAdapter } from "./local-storage-adapter";
import type { Org, User } from "../types/org";
import type { Workspace } from "../../store/ide";

describe("LocalStorageAdapter", () => {
  let adapter: LocalStorageAdapter;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map<string, string>();
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    };
    adapter = new LocalStorageAdapter();
  });

  const mockOrg = (): Org => ({
    id: "org1",
    name: "Test Org",
    slug: "test-org",
    createdAt: Date.now(),
  });

  const mockUser = (): User => ({
    id: "user1",
    displayName: "Test User",
    email: "test@example.com",
    defaultAgent: "claude",
  });

  const mockWorkspace = (overrides?: Partial<Workspace>): Workspace => ({
    id: "ws1",
    letter: "A",
    name: "Test Workspace",
    color: "#ff0000",
    source: { kind: "mock", id: "mock1" },
    orgId: "org1",
    ...overrides,
  });

  it("should store and retrieve org", async () => {
    const org = mockOrg();
    await adapter.putOrg(org);
    const retrieved = await adapter.getOrg();
    expect(retrieved).toEqual(org);
  });

  it("should return null for missing org", async () => {
    const result = await adapter.getOrg();
    expect(result).toBeNull();
  });

  it("should store and retrieve user", async () => {
    const user = mockUser();
    await adapter.putUser(user);
    const retrieved = await adapter.getUser();
    expect(retrieved).toEqual(user);
  });

  it("should return null for missing user", async () => {
    const result = await adapter.getUser();
    expect(result).toBeNull();
  });

  it("should store and retrieve workspaces for an org", async () => {
    const org = mockOrg();
    const ws1 = mockWorkspace();
    const ws2 = mockWorkspace({ id: "ws2", name: "Workspace 2" });

    await adapter.putWorkspace(org.id, ws1);
    await adapter.putWorkspace(org.id, ws2);

    const workspaces = await adapter.getWorkspaces(org.id);
    expect(workspaces).toHaveLength(2);
    expect(workspaces.map((w) => w.id)).toContain("ws1");
    expect(workspaces.map((w) => w.id)).toContain("ws2");
  });

  it("should return empty array for org with no workspaces", async () => {
    const result = await adapter.getWorkspaces("nonexistent");
    expect(result).toEqual([]);
  });

  it("should update existing workspace", async () => {
    const org = mockOrg();
    const ws = mockWorkspace();
    const updated = { ...ws, name: "Updated Name" };

    await adapter.putWorkspace(org.id, ws);
    await adapter.putWorkspace(org.id, updated);

    const workspaces = await adapter.getWorkspaces(org.id);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe("Updated Name");
  });

  it("should remove workspace", async () => {
    const org = mockOrg();
    const ws1 = mockWorkspace();
    const ws2 = mockWorkspace({ id: "ws2", name: "Workspace 2" });

    await adapter.putWorkspace(org.id, ws1);
    await adapter.putWorkspace(org.id, ws2);
    await adapter.removeWorkspace(org.id, "ws1");

    const workspaces = await adapter.getWorkspaces(org.id);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].id).toBe("ws2");
  });

  it("should remove localStorage key when removing last workspace", async () => {
    const org = mockOrg();
    const ws = mockWorkspace();

    await adapter.putWorkspace(org.id, ws);
    await adapter.removeWorkspace(org.id, "ws1");

    const key = `ide.ws.${org.id}.v1`;
    expect(storage.has(key)).toBe(false);
  });

  it("should export all data", async () => {
    const org = mockOrg();
    const user = mockUser();
    const ws = mockWorkspace();

    await adapter.putOrg(org);
    await adapter.putUser(user);
    await adapter.putWorkspace(org.id, ws);

    const snapshot = await adapter.exportAll();
    expect(snapshot.version).toBe("v1");
    expect(snapshot.org).toEqual(org);
    expect(snapshot.user).toEqual(user);
    expect(snapshot.workspacesByOrgId[org.id]).toHaveLength(1);
    expect(snapshot.workspacesByOrgId[org.id][0].id).toBe("ws1");
  });

  it("should import all data", async () => {
    const org = mockOrg();
    const user = mockUser();
    const ws = mockWorkspace();

    const snapshot = {
      version: "v1",
      org,
      user,
      workspacesByOrgId: {
        [org.id]: [ws],
      },
    };

    await adapter.importAll(snapshot);

    const retrievedOrg = await adapter.getOrg();
    const retrievedUser = await adapter.getUser();
    const retrievedWs = await adapter.getWorkspaces(org.id);

    expect(retrievedOrg).toEqual(org);
    expect(retrievedUser).toEqual(user);
    expect(retrievedWs).toHaveLength(1);
    expect(retrievedWs[0]).toEqual(ws);
  });

  it("should round-trip export and import", async () => {
    const org1 = mockOrg();
    const user1 = mockUser();
    const ws1a = mockWorkspace({ id: "ws1a" });
    const ws1b = mockWorkspace({ id: "ws1b", name: "Workspace 1B" });

    await adapter.putOrg(org1);
    await adapter.putUser(user1);
    await adapter.putWorkspace(org1.id, ws1a);
    await adapter.putWorkspace(org1.id, ws1b);

    const exported = await adapter.exportAll();

    storage.clear();
    const adapter2 = new LocalStorageAdapter();
    await adapter2.importAll(exported);

    const snapshot = await adapter2.exportAll();
    expect(snapshot).toEqual(exported);
  });
});
