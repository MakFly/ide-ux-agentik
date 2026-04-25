import type { Org, User } from "../types/org";
import type { Workspace } from "../../store/ide";

export interface StorageAdapter {
  getOrg(): Promise<Org | null>;
  putOrg(org: Org): Promise<void>;
  getUser(): Promise<User | null>;
  putUser(user: User): Promise<void>;
  getWorkspaces(orgId: string): Promise<Workspace[]>;
  putWorkspace(orgId: string, workspace: Workspace): Promise<void>;
  removeWorkspace(orgId: string, wsId: string): Promise<void>;
  exportAll(): Promise<Snapshot>;
  importAll(snapshot: Snapshot): Promise<void>;
}

export type Snapshot = {
  version: string;
  org: Org | null;
  user: User | null;
  workspacesByOrgId: Record<string, Workspace[]>;
};
