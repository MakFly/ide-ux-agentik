/**
 * Server-backed storage: org, user, workspaces all live on the agent SQLite.
 * The client holds NO copy beyond an in-memory cache hydrated on demand.
 *
 * Connection: the singleton `RemoteAgentProvider` is built lazily from the
 * global `AgentEndpoint` resolved by ./endpoint.ts. If no endpoint is
 * configured yet (pre-wizard), every method throws `StorageNotConnected`.
 */
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import type { Org, User } from "../types/org";
import type { Workspace, WorkspaceSource } from "../../store/ide";
import type { StorageAdapter, Snapshot } from "./types";
import { getEndpoint } from "./endpoint";

export class StorageNotConnected extends Error {
  constructor() {
    super("Agent endpoint not configured — run the setup wizard first.");
    this.name = "StorageNotConnected";
  }
}

let _provider: RemoteAgentProvider | null = null;
let _connectInflight: Promise<RemoteAgentProvider> | null = null;

async function getProvider(): Promise<RemoteAgentProvider> {
  if (_provider) return _provider;
  if (_connectInflight) return _connectInflight;

  const endpoint = getEndpoint();
  if (!endpoint) throw new StorageNotConnected();

  _connectInflight = (async () => {
    const p = new RemoteAgentProvider(endpoint.label, endpoint.url, endpoint.token);
    await p.connect();
    _provider = p;
    return p;
  })().finally(() => {
    _connectInflight = null;
  });

  return _connectInflight;
}

/** Reset the cached provider — used after `clearEndpoint()` so the next call
 *  rebuilds against the new endpoint. */
export function resetProviderCache(): void {
  _provider = null;
  _connectInflight = null;
}

/** Hand a pre-connected provider to the storage layer (e.g. wizard's test
 *  connection succeeded — reuse that socket instead of reconnecting). */
export function attachProvider(provider: RemoteAgentProvider): void {
  _provider = provider;
}

type WireOrg = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  createdAt: number;
};

type WireUser = {
  id: string;
  displayName: string;
  email?: string;
  defaultAgent: string;
};

type WireWorkspace = {
  id: string;
  orgId: string;
  name: string;
  letter: string;
  color: string;
  gitUrl?: string;
  rootPath?: string;
  source: WorkspaceSource;
};

function toUser(w: WireUser): User {
  return {
    id: w.id,
    displayName: w.displayName,
    email: w.email,
    defaultAgent: w.defaultAgent as User["defaultAgent"],
  };
}

function toWorkspace(w: WireWorkspace): Workspace {
  return {
    id: w.id,
    name: w.name,
    letter: w.letter,
    color: w.color,
    gitUrl: w.gitUrl,
    rootPath: w.rootPath,
    source: w.source,
    orgId: w.orgId,
  };
}

export class ServerStorageAdapter implements StorageAdapter {
  async getOrg(): Promise<Org | null> {
    const p = await getProvider();
    return p.call<WireOrg | null>("org.get", {});
  }

  async putOrg(org: Org): Promise<void> {
    const p = await getProvider();
    await p.call("org.put", { org });
  }

  async getUser(): Promise<User | null> {
    const p = await getProvider();
    const u = await p.call<WireUser | null>("user.get", {});
    return u ? toUser(u) : null;
  }

  async putUser(user: User): Promise<void> {
    const p = await getProvider();
    await p.call("user.put", { user });
  }

  async getWorkspaces(orgId: string): Promise<Workspace[]> {
    const p = await getProvider();
    const list = await p.call<WireWorkspace[]>("workspaces.list", { orgId });
    return list.map(toWorkspace);
  }

  async putWorkspace(_orgId: string, workspace: Workspace): Promise<void> {
    const p = await getProvider();
    await p.call("workspaces.put", { workspace });
  }

  async removeWorkspace(_orgId: string, wsId: string): Promise<void> {
    const p = await getProvider();
    await p.call("workspaces.delete", { id: wsId });
  }

  async exportAll(): Promise<Snapshot> {
    const org = await this.getOrg();
    const user = await this.getUser();
    const workspacesByOrgId: Record<string, Workspace[]> = {};
    if (org) workspacesByOrgId[org.id] = await this.getWorkspaces(org.id);
    return { version: "server-v1", org, user, workspacesByOrgId };
  }

  async importAll(snapshot: Snapshot): Promise<void> {
    if (snapshot.org) {
      await this.putOrg(snapshot.org);
      const workspaces = snapshot.workspacesByOrgId[snapshot.org.id] ?? [];
      for (const ws of workspaces) await this.putWorkspace(snapshot.org.id, ws);
    }
    if (snapshot.user) await this.putUser(snapshot.user);
  }
}
