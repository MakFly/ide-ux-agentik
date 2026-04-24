/**
 * Abstract filesystem for workspaces.
 *
 * Implemented by:
 *   - MockProvider        — in-memory, used for demos and default seeded data
 *   - LocalWebProvider    — File System Access API (Chromium browsers)
 *   - RemoteAgentProvider — WebSocket + JSON-RPC against a pre-installed agent
 *
 * Later (Tauri build) will add:
 *   - LocalNativeProvider — tokio fs via Tauri IPC
 *   - SshTunnelProvider   — SSH + remote agent via native tunnel
 *
 * All providers target the same semantics: directory-based workspaces, UTF-8
 * text files unless flagged binary. Paths are forward-slash, relative to the
 * workspace root. No leading slash.
 */

export type FsEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  mtime?: number;
};

export type FsWatchEvent = {
  kind: "created" | "modified" | "deleted" | "renamed";
  path: string;
  oldPath?: string;
};

export type FsUnsubscribe = () => void;

export type WorkspaceSource =
  | { kind: "mock"; id: string }
  | { kind: "local-web"; handleId: string; name: string }
  | { kind: "remote-agent"; url: string; token: string; label: string };

export interface FsProvider {
  readonly kind: WorkspaceSource["kind"];
  readonly label: string;

  /** Connect / open. May request user permission (FSA, WS auth). */
  connect(): Promise<void>;

  /** Release resources (close WS, drop permission cache). */
  disconnect(): Promise<void>;

  list(path: string): Promise<FsEntry[]>;
  stat(path: string): Promise<FsEntry>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;

  /** Subscribe to changes under `path`. Optional — noop if unsupported. */
  watch?(path: string, cb: (ev: FsWatchEvent) => void): FsUnsubscribe;
}

export class FsError extends Error {
  constructor(
    message: string,
    public readonly code: "not-found" | "permission" | "io" | "protocol" | "auth" | "not-supported",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FsError";
  }
}
