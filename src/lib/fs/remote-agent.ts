import {
  FsError,
  type FsEntry,
  type FsProvider,
  type FsUnsubscribe,
  type FsWatchEvent,
} from "./types";

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

/** A non-interactive chat subprocess (codex exec --json, claude -p). */
export type ChatCli = "codex" | "claude";
export type ChatEvent = Record<string, unknown>;
export type ChatSpawnParams = {
  cli: ChatCli;
  prompt: string;
  cwd?: string;
  env?: Record<string, string>;
  extraArgs?: string[];
};
export type ChatHandle = {
  id: string;
  kill(signal?: string): void;
  onEvent(cb: (event: ChatEvent) => void): () => void;
  onEnd(cb: (code: number | null, signal: string | null) => void): () => void;
};

export type Task = {
  id: string;
  workspaceId: string;
  parentSessionId: string | null;
  title: string;
  prompt: string;
  cli: string;
  status: "queued" | "running" | "awaiting" | "done" | "failed" | "cancelled";
  worktreePath: string | null;
  branchName: string | null;
  baseRef: string | null;
  exitCode: number | null;
  errorMessage: string | null;
  sessionId: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
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

function taskFromDb(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    parentSessionId: (row.parent_session_id as string) || null,
    title: row.title as string,
    prompt: row.prompt as string,
    cli: row.cli as string,
    status: row.status as Task["status"],
    worktreePath: (row.worktree_path as string) || null,
    branchName: (row.branch_name as string) || null,
    baseRef: (row.base_ref as string) || null,
    exitCode: (row.exit_code as number) || null,
    errorMessage: (row.error_message as string) || null,
    sessionId: (row.session_id as string) || null,
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number) || null,
    endedAt: (row.ended_at as number) || null,
  };
}

export class RemoteAgentProvider implements FsProvider {
  readonly kind = "remote-agent" as const;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private watchers = new Map<string, (ev: FsWatchEvent) => void>();
  private ptyDataListeners = new Map<string, Set<(data: string) => void>>();
  private ptyExitListeners = new Map<
    string,
    Set<(code: number | null, signal: string | null) => void>
  >();
  private chatEventListeners = new Map<string, Set<(event: ChatEvent) => void>>();
  private chatEndListeners = new Map<
    string,
    Set<(code: number | null, signal: string | null) => void>
  >();
  private cloneProgressListeners = new Map<
    string,
    Set<(chunk: { stream: "stdout" | "stderr"; data: string }) => void>
  >();
  private cloneEndListeners = new Map<string, Set<(r: { code: number; dest: string }) => void>>();
  private taskCreatedListeners = new Set<(t: Task) => void>();
  private taskStartedListeners = new Set<
    (e: { taskId: string; sessionId: string; worktreePath: string; branchName: string }) => void
  >();
  private taskEventListeners = new Set<(e: { taskId: string; event: unknown }) => void>();
  private taskEndedListeners = new Set<
    (e: {
      taskId: string;
      status: Task["status"];
      exitCode: number | null;
      errorMessage: string | null;
    }) => void
  >();
  private taskWorktreeRemovedListeners = new Set<(e: { taskId: string }) => void>();
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
        // 1. Reject any outstanding RPC call so awaiters fail fast.
        for (const p of this.pending.values())
          p.reject(new FsError("Agent connection closed", "io"));
        this.pending.clear();
        // 2. Synthesize terminal events for every in-flight stream so async
        //    consumers (codex-adapter generator, xterm PTY loop) can unblock.
        for (const [, listeners] of this.chatEndListeners) {
          for (const cb of listeners) {
            try {
              cb(null, "closed");
            } catch {
              /* consumer threw — still clear */
            }
          }
        }
        for (const [, listeners] of this.ptyExitListeners) {
          for (const cb of listeners) {
            try {
              cb(null, "closed");
            } catch {
              /* ignore */
            }
          }
        }
        this.chatEventListeners.clear();
        this.chatEndListeners.clear();
        this.ptyDataListeners.clear();
        this.ptyExitListeners.clear();
        this.cloneProgressListeners.clear();
        this.cloneEndListeners.clear();
        this.taskCreatedListeners.clear();
        this.taskStartedListeners.clear();
        this.taskEventListeners.clear();
        this.taskEndedListeners.clear();
        this.taskWorktreeRemovedListeners.clear();
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
      const { id, code, signal } = msg.params as {
        id: string;
        code: number | null;
        signal: string | null;
      };
      for (const cb of this.ptyExitListeners.get(id) ?? []) cb(code, signal);
      this.ptyDataListeners.delete(id);
      this.ptyExitListeners.delete(id);
      return;
    }
    if ("method" in msg && msg.method === "chat.event") {
      const { id, event } = msg.params as { id: string; event: ChatEvent };
      for (const cb of this.chatEventListeners.get(id) ?? []) cb(event);
      return;
    }
    if ("method" in msg && msg.method === "chat.end") {
      const { id, code, signal } = msg.params as {
        id: string;
        code: number | null;
        signal: string | null;
      };
      for (const cb of this.chatEndListeners.get(id) ?? []) cb(code, signal);
      this.chatEventListeners.delete(id);
      this.chatEndListeners.delete(id);
    }
    if ("method" in msg && msg.method === "git.clone.progress") {
      const { id, stream, data } = msg.params as {
        id: string;
        stream: "stdout" | "stderr";
        data: string;
      };
      for (const cb of this.cloneProgressListeners.get(id) ?? []) cb({ stream, data });
      return;
    }
    if ("method" in msg && msg.method === "git.clone.end") {
      const { id, code, dest } = msg.params as {
        id: string;
        code: number;
        dest: string;
      };
      for (const cb of this.cloneEndListeners.get(id) ?? []) cb({ code, dest });
      this.cloneProgressListeners.delete(id);
      this.cloneEndListeners.delete(id);
      return;
    }
    if ("method" in msg && msg.method === "task.created") {
      const { task } = msg.params as { task: Record<string, unknown> };
      const t = taskFromDb(task);
      for (const cb of this.taskCreatedListeners) {
        try {
          cb(t);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if ("method" in msg && msg.method === "task.started") {
      const { taskId, sessionId, worktreePath, branchName } = msg.params as {
        taskId: string;
        sessionId: string;
        worktreePath: string;
        branchName: string;
      };
      for (const cb of this.taskStartedListeners) {
        try {
          cb({ taskId, sessionId, worktreePath, branchName });
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if ("method" in msg && msg.method === "task.event") {
      const { taskId, event } = msg.params as { taskId: string; event: unknown };
      for (const cb of this.taskEventListeners) {
        try {
          cb({ taskId, event });
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if ("method" in msg && msg.method === "task.ended") {
      const { taskId, status, exitCode, errorMessage } = msg.params as {
        taskId: string;
        status: Task["status"];
        exitCode: number | null;
        errorMessage: string | null;
      };
      for (const cb of this.taskEndedListeners) {
        try {
          cb({ taskId, status, exitCode, errorMessage });
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if ("method" in msg && msg.method === "task.worktreeRemoved") {
      const { taskId } = msg.params as { taskId: string };
      for (const cb of this.taskWorktreeRemovedListeners) {
        try {
          cb({ taskId });
        } catch {
          /* ignore */
        }
      }
      return;
    }
  }

  call<T>(method: string, params?: unknown): Promise<T> {
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
      write: (data) => {
        this.call<void>("pty.write", { id, data }).catch(() => {});
      },
      resize: (cols, rows) => {
        this.call<void>("pty.resize", { id, cols, rows }).catch(() => {});
      },
      kill: (signal) => {
        this.call<void>("pty.kill", { id, signal }).catch(() => {});
      },
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

  async ptyList(): Promise<{
    sessions: Array<{ id: string; cmd: string; cwd: string; alive: boolean }>;
  }> {
    return this.call("pty.list", {});
  }

  private onChatEvent(id: string, cb: (event: ChatEvent) => void): () => void {
    if (!this.chatEventListeners.has(id)) this.chatEventListeners.set(id, new Set());
    this.chatEventListeners.get(id)!.add(cb);
    return () => this.chatEventListeners.get(id)?.delete(cb);
  }

  private onChatEnd(
    id: string,
    cb: (code: number | null, signal: string | null) => void,
  ): () => void {
    if (!this.chatEndListeners.has(id)) this.chatEndListeners.set(id, new Set());
    this.chatEndListeners.get(id)!.add(cb);
    return () => this.chatEndListeners.get(id)?.delete(cb);
  }

  onCloneProgress(
    id: string,
    cb: (chunk: { stream: "stdout" | "stderr"; data: string }) => void,
  ): () => void {
    if (!this.cloneProgressListeners.has(id)) this.cloneProgressListeners.set(id, new Set());
    this.cloneProgressListeners.get(id)!.add(cb);
    return () => this.cloneProgressListeners.get(id)?.delete(cb);
  }

  onCloneEnd(id: string, cb: (r: { code: number; dest: string }) => void): () => void {
    if (!this.cloneEndListeners.has(id)) this.cloneEndListeners.set(id, new Set());
    this.cloneEndListeners.get(id)!.add(cb);
    return () => this.cloneEndListeners.get(id)?.delete(cb);
  }

  async chatSpawn(params: ChatSpawnParams): Promise<ChatHandle> {
    const { id } = await this.call<{ id: string }>("chat.spawn", params);
    return {
      id,
      kill: (signal) => {
        this.call<void>("chat.kill", { id, signal }).catch(() => {});
      },
      onEvent: (cb) => this.onChatEvent(id, cb),
      onEnd: (cb) => this.onChatEnd(id, cb),
    };
  }

  async gitStatus(workspacePath: string): Promise<{
    branch: string;
    files: Array<{ path: string; staged: boolean; unstaged: boolean; kind: string }>;
  }> {
    return this.call("git.status", { workspacePath });
  }

  async gitStage(workspacePath: string, paths: string[]): Promise<{ ok: boolean }> {
    return this.call("git.stage", { workspacePath, paths });
  }

  async gitCommit(
    workspacePath: string,
    message: string,
  ): Promise<{ sha: string | null; message: string }> {
    return this.call("git.commit", { workspacePath, message });
  }

  async gitDiff(workspacePath: string, staged?: boolean): Promise<{ patch: string }> {
    return this.call("git.diff", { workspacePath, staged: staged ?? false });
  }

  async gitClone(
    url: string,
    dest: string,
    env?: Record<string, string>,
  ): Promise<{ id: string; dest: string }> {
    return this.call("git.clone", { url, dest, env });
  }

  async gitDetectInstall(dir: string): Promise<null | { tool: string; args: string[] }> {
    return this.call("git.detectInstall", { dir });
  }

  async gitCloneCancel(id: string): Promise<void> {
    await this.call<void>("git.clone.cancel", { id });
  }

  async taskCreate(params: {
    workspaceId: string;
    title: string;
    prompt: string;
    cli: string;
    baseRef?: string;
    parentSessionId?: string;
  }): Promise<{ id: string }> {
    return this.call("task.create", params);
  }

  async taskList(params: { workspaceId: string; status?: Task["status"] }): Promise<Task[]> {
    const tasks = await this.call<Record<string, unknown>[]>("task.list", params);
    return tasks.map(taskFromDb);
  }

  async taskStart(id: string): Promise<void> {
    await this.call<void>("task.start", { id });
  }

  async taskCancel(id: string): Promise<void> {
    await this.call<void>("task.cancel", { id });
  }

  async taskRemoveWorktree(id: string, deleteBranch?: boolean): Promise<void> {
    await this.call<void>("task.removeWorktree", { id, deleteBranch });
  }

  onTaskCreated(cb: (task: Task) => void): () => void {
    this.taskCreatedListeners.add(cb);
    return () => this.taskCreatedListeners.delete(cb);
  }

  onTaskStarted(
    cb: (e: {
      taskId: string;
      sessionId: string;
      worktreePath: string;
      branchName: string;
    }) => void,
  ): () => void {
    this.taskStartedListeners.add(cb);
    return () => this.taskStartedListeners.delete(cb);
  }

  onTaskEvent(cb: (e: { taskId: string; event: unknown }) => void): () => void {
    this.taskEventListeners.add(cb);
    return () => this.taskEventListeners.delete(cb);
  }

  onTaskEnded(
    cb: (e: {
      taskId: string;
      status: Task["status"];
      exitCode: number | null;
      errorMessage: string | null;
    }) => void,
  ): () => void {
    this.taskEndedListeners.add(cb);
    return () => this.taskEndedListeners.delete(cb);
  }

  onTaskWorktreeRemoved(cb: (e: { taskId: string }) => void): () => void {
    this.taskWorktreeRemovedListeners.add(cb);
    return () => this.taskWorktreeRemovedListeners.delete(cb);
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
