import { FsError, type FsEntry, type FsProvider, type FsUnsubscribe, type FsWatchEvent } from "./types";

export type PtySpawnParams = {
  cmd?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
};

export type PtyHandle = {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): () => void;
  onExit(cb: (code: number | null, signal: string | null) => void): () => void;
};

/**
 * Remote-agent provider.
 *
 * Speaks JSON-RPC 2.0 over a WebSocket to a pre-installed agent running on
 * the target machine (see `agent/` directory for the reference Bun
 * implementation). The first message after connect must be an `auth` call
 * carrying the shared token.
 *
 * Protocol methods (all paths are UTF-8 strings, relative to agent root):
 *   - auth(token)                 → { ok: true }
 *   - ls(path)                    → FsEntry[]
 *   - stat(path)                  → FsEntry
 *   - readFile(path)              → string (utf-8)
 *   - writeFile(path, content)    → { ok: true }
 *   - mkdir(path)                 → { ok: true }
 *   - remove(path)                → { ok: true }
 *   - rename(oldPath, newPath)    → { ok: true }
 *
 * Notifications (server → client):
 *   - { method: "watch", params: { subId, event } }
 */

type JsonRpcId = string | number;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

export class RemoteAgentProvider implements FsProvider {
  readonly kind = "remote-agent" as const;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private watchers = new Map<string, (ev: FsWatchEvent) => void>();
  private ptyDataListeners = new Map<string, Set<(data: string) => void>>();
  private ptyExitListeners = new Map<string, Set<(code: number | null, signal: string | null) => void>>();
  private connecting: Promise<void> | null = null;

  constructor(
    readonly label: string,
    private readonly url: string,
    private readonly token: string,
  ) {}

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(new FsError(`Invalid agent URL: ${this.url}`, "protocol", e));
        return;
      }
      this.ws = ws;

      ws.addEventListener("message", (ev) => this.onMessage(ev));
      ws.addEventListener("error", () => {
        reject(new FsError(`Cannot reach agent at ${this.url}`, "io"));
      });
      ws.addEventListener("close", () => {
        for (const p of this.pending.values()) p.reject(new FsError("Agent connection closed", "io"));
        this.pending.clear();
      });
      ws.addEventListener("open", async () => {
        try {
          await this.call("auth", { token: this.token });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.watchers.clear();
  }

  private onMessage(ev: MessageEvent<string>) {
    let msg: JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if ("id" in msg && msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if ("error" in msg && msg.error) {
        p.reject(new FsError(msg.error.message, "io"));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if ("method" in msg && msg.method === "watch") {
      const { subId, event } = msg.params as { subId: string; event: FsWatchEvent };
      this.watchers.get(subId)?.(event);
      return;
    }
    if ("method" in msg && msg.method === "pty.data") {
      const { id, data } = msg.params as { id: string; data: string };
      for (const cb of this.ptyDataListeners.get(id) ?? []) cb(data);
      return;
    }
    if ("method" in msg && msg.method === "pty.exit") {
      const { id, code, signal } = msg.params as { id: string; code: number | null; signal: string | null };
      for (const cb of this.ptyExitListeners.get(id) ?? []) cb(code, signal);
      this.ptyDataListeners.delete(id);
      this.ptyExitListeners.delete(id);
    }
  }

  private call<T>(method: string, params?: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new FsError("Agent not connected", "io"));
    }
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      ws.send(JSON.stringify(req));
    });
  }

  async list(path: string): Promise<FsEntry[]> {
    return this.call<FsEntry[]>("ls", { path });
  }
  async stat(path: string): Promise<FsEntry> {
    return this.call<FsEntry>("stat", { path });
  }
  async readFile(path: string): Promise<string> {
    return this.call<string>("readFile", { path });
  }
  async writeFile(path: string, content: string): Promise<void> {
    await this.call<void>("writeFile", { path, content });
  }
  async mkdir(path: string): Promise<void> {
    await this.call<void>("mkdir", { path });
  }
  async remove(path: string): Promise<void> {
    await this.call<void>("remove", { path });
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.call<void>("rename", { oldPath, newPath });
  }

  onPtyData(id: string, cb: (data: string) => void): () => void {
    if (!this.ptyDataListeners.has(id)) this.ptyDataListeners.set(id, new Set());
    this.ptyDataListeners.get(id)!.add(cb);
    return () => this.ptyDataListeners.get(id)?.delete(cb);
  }

  onPtyExit(id: string, cb: (code: number | null, signal: string | null) => void): () => void {
    if (!this.ptyExitListeners.has(id)) this.ptyExitListeners.set(id, new Set());
    this.ptyExitListeners.get(id)!.add(cb);
    return () => this.ptyExitListeners.get(id)?.delete(cb);
  }

  async ptySpawn(params: PtySpawnParams = {}): Promise<PtyHandle> {
    const { id } = await this.call<{ id: string }>("pty.spawn", params);
    return {
      id,
      write: (data) => { this.call<void>("pty.write", { id, data }).catch(() => {}); },
      resize: (cols, rows) => { this.call<void>("pty.resize", { id, cols, rows }).catch(() => {}); },
      kill: (signal) => { this.call<void>("pty.kill", { id, signal }).catch(() => {}); },
      onData: (cb) => this.onPtyData(id, cb),
      onExit: (cb) => this.onPtyExit(id, cb),
    };
  }

  async ptyWrite(id: string, data: string): Promise<void> {
    await this.call<void>("pty.write", { id, data });
  }

  async ptyResize(id: string, cols: number, rows: number): Promise<void> {
    await this.call<void>("pty.resize", { id, cols, rows });
  }

  async ptyKill(id: string, signal?: string): Promise<void> {
    await this.call<void>("pty.kill", { id, signal });
  }

  /** One-shot non-interactive command (uses pipes, not PTY). */
  async execRun(params: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return this.call("exec.run", params);
  }

  async ptyList(): Promise<{ sessions: Array<{ id: string; cmd: string; cwd: string; alive: boolean }> }> {
    return this.call("pty.list", {});
  }

  watch(path: string, cb: (ev: FsWatchEvent) => void): FsUnsubscribe {
    const subId = crypto.randomUUID();
    this.watchers.set(subId, cb);
    this.call<void>("watch", { path, subId }).catch(() => this.watchers.delete(subId));
    return () => {
      this.watchers.delete(subId);
      this.call<void>("unwatch", { subId }).catch(() => {});
    };
  }
}
