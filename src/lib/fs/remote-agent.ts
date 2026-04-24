import { FsError, type FsEntry, type FsProvider, type FsUnsubscribe, type FsWatchEvent } from "./types";

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
