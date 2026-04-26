import { toast } from "sonner";

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

export type TaskLogEntry = {
  id: number;
  taskId: string;
  ts: number;
  level: "info" | "warn" | "error";
  source: "stdout" | "stderr" | "spawn";
  data: unknown;
};

export type Task = {
  id: string;
  workspaceId: string;
  parentSessionId: string | null;
  title: string;
  prompt: string;
  cli: string;
  model: string | null;
  effort: string | null;
  status: "queued" | "running" | "awaiting" | "done" | "failed" | "cancelled";
  worktreePath: string | null;
  branchName: string | null;
  baseRef: string | null;
  exitCode: number | null;
  errorMessage: string | null;
  agentSessionId: string | null;
  sessionId: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  parentTaskId: string | null;
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
    model: (row.model as string) || null,
    effort: (row.effort as string) || null,
    status: row.status as Task["status"],
    worktreePath: (row.worktree_path as string) || null,
    branchName: (row.branch_name as string) || null,
    baseRef: (row.base_ref as string) || null,
    exitCode: (row.exit_code as number) || null,
    errorMessage: (row.error_message as string) || null,
    agentSessionId: (row.agent_session_id as string) || null,
    sessionId: (row.session_id as string) || null,
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number) || null,
    endedAt: (row.ended_at as number) || null,
    parentTaskId: (row.parent_task_id as string) || null,
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
  private taskSessionAttachedListeners = new Set<
    (e: { taskId: string; sessionId: string; role: "peer"; cli: string }) => void
  >();
  private taskWorktreeRemovedListeners = new Set<(e: { taskId: string }) => void>();
  private connecting: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
      ws.addEventListener("close", (ev) => {
        // Skip reconnect on normal close (codes 1000/1001).
        if (ev.code === 1000 || ev.code === 1001) {
          this.pending.clear();
          this.ptyDataListeners.clear();
          this.ptyExitListeners.clear();
          this.cloneProgressListeners.clear();
          this.cloneEndListeners.clear();
          this.taskCreatedListeners.clear();
          this.taskStartedListeners.clear();
          this.taskEventListeners.clear();
          this.taskEndedListeners.clear();
          this.taskSessionAttachedListeners.clear();
          this.taskWorktreeRemovedListeners.clear();
          return;
        }

        // Attempt auto-reconnect with exponential backoff.
        void this._reconnect();
      });
      ws.addEventListener("open", async () => {
        try {
          await this.call("auth", { token: this.token });
          resolve();
        } catch (e) {
          if (this.ws === ws) this.ws = null;
          ws.close(1000, "auth failed");
          reject(e);
        }
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.watchers.clear();
  }

  private _clearPending(reason: string): void {
    for (const p of this.pending.values()) {
      try {
        p.reject(new FsError(reason, "io"));
      } catch {
        /* ignore */
      }
    }
    this.pending.clear();
  }

  private async _reconnect(): Promise<void> {
    const delays = [1000, 2000, 4000, 8000, 16000];
    const maxAttempts = 5;

    // Reject all in-flight RPCs immediately so callers don't hang during reconnect.
    this._clearPending("Agent connection lost — reconnecting");

    // Skip the toast on the first attempt: short flaps (HMR, brief network
    // blip, dev-agent restart) usually reconnect within ~1s and the toast
    // would just flash for nothing. Surface UI noise only from attempt 2.
    if (this.reconnectAttempts === 1) {
      toast.loading("Reconnecting to agent…", { id: "agent-reconnect" });
    }

    if (this.reconnectAttempts >= maxAttempts) {
      toast.error("Lost connection to agent — refresh the page", {
        id: "agent-reconnect",
        duration: Infinity,
      });
      // Clear all pending RPCs and listeners on final abandon.
      for (const p of this.pending.values()) p.reject(new FsError("Agent connection closed", "io"));
      this.pending.clear();
      for (const [, listeners] of this.ptyExitListeners) {
        for (const cb of listeners) {
          try {
            cb(null, "closed");
          } catch {
            /* ignore */
          }
        }
      }
      this.ptyDataListeners.clear();
      this.ptyExitListeners.clear();
      this.cloneProgressListeners.clear();
      this.cloneEndListeners.clear();
      this.taskCreatedListeners.clear();
      this.taskStartedListeners.clear();
      this.taskEventListeners.clear();
      this.taskEndedListeners.clear();
      this.taskSessionAttachedListeners.clear();
      this.taskWorktreeRemovedListeners.clear();
      this.reconnectAttempts = 0;
      return;
    }

    const delay = delays[this.reconnectAttempts];
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().then(
        () => {
          toast.success("Reconnected", { id: "agent-reconnect" });
          setTimeout(() => toast.dismiss("agent-reconnect"), 2000);
          this.reconnectAttempts = 0;
        },
        () => {
          void this._reconnect();
        },
      );
    }, delay);
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
    if ("method" in msg && msg.method === "task.sessionAttached") {
      const { taskId, sessionId, role, cli } = msg.params as {
        taskId: string;
        sessionId: string;
        role: "peer";
        cli: string;
      };
      for (const cb of this.taskSessionAttachedListeners) {
        try {
          cb({ taskId, sessionId, role, cli });
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
    model?: string;
    effort?: string;
    baseRef?: string;
    parentSessionId?: string;
    parentTaskId?: string;
  }): Promise<{ id: string; sessionId: string }> {
    return this.call("task.create", params);
  }

  async taskList(params: { workspaceId: string; status?: Task["status"] }): Promise<Task[]> {
    const tasks = await this.call<Record<string, unknown>[]>("task.list", params);
    return tasks.map(taskFromDb);
  }

  async taskLogsList(params: {
    taskId: string;
    since?: number;
    limit?: number;
  }): Promise<TaskLogEntry[]> {
    const rows = await this.call<Record<string, unknown>[]>("task.logs.list", params);
    return rows.map((r) => {
      const raw = r.data_json;
      let parsed: unknown = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { type: "raw", text: raw };
        }
      }
      return {
        id: r.id as number,
        taskId: r.task_id as string,
        ts: r.ts as number,
        level: r.level as TaskLogEntry["level"],
        source: r.source as TaskLogEntry["source"],
        data: parsed,
      };
    });
  }

  async taskStart(id: string): Promise<void> {
    await this.call<void>("task.start", { id });
  }

  async taskContinue(params: {
    taskId: string;
    prompt: string;
    model?: string;
    effort?: string;
  }): Promise<void> {
    await this.call<void>("task.continue", params);
  }

  async taskCancel(id: string): Promise<void> {
    await this.call<void>("task.cancel", { id });
  }

  async taskRemoveWorktree(id: string, deleteBranch?: boolean): Promise<void> {
    await this.call<void>("task.removeWorktree", { id, deleteBranch });
  }

  async taskUpdate(taskId: string, patch: { sessionId?: string | null }): Promise<void> {
    await this.call<void>("task.update", { taskId, patch });
  }

  async taskSessionList(params: { taskId: string }): Promise<
    Array<{
      sessionId: string;
      role: "primary" | "peer";
      createdAt: number;
      closedAt: number | null;
      cli: string;
    }>
  > {
    return this.call("task.sessionList", params);
  }

  async taskAttachSession(params: {
    taskId: string;
    cli: string;
    model?: string;
    effort?: string;
  }): Promise<{ taskId: string; sessionId: string; role: "peer" }> {
    return this.call("task.attachSession", params);
  }

  async sessionsCreate(params: {
    id: string;
    workspaceId: string;
    cli: string;
    title?: string;
  }): Promise<void> {
    await this.call<void>("sessions.create", params);
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

  onTaskSessionAttached(
    cb: (e: { taskId: string; sessionId: string; role: "peer"; cli: string }) => void,
  ): () => void {
    this.taskSessionAttachedListeners.add(cb);
    return () => this.taskSessionAttachedListeners.delete(cb);
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
