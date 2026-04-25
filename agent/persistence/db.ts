import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DDL } from "./schema.ts";

export type Session = {
  id: string;
  workspace_id: string;
  cli: string;
  title: string | null;
  model: string | null;
  approval_mode: string | null;
  created_at: number;
  updated_at: number;
  status: string;
};

export type Message = {
  id: string;
  session_id: string;
  parent_id: string | null;
  logical_parent_id: string | null;
  is_sidechain: number;
  role: string;
  parts_json: string;
  cwd: string | null;
  git_branch: string | null;
  slug: string | null;
  version: string | null;
  ts: number;
};

export type FileBlob = {
  id: string;
  size: number;
  ts: number;
};

export type FileSnapshot = {
  id: string;
  session_id: string;
  message_id: string | null;
  path: string;
  content_before_hash: string | null;
  content_after_hash: string | null;
  ts: number;
};

export type Summary = {
  id: number;
  session_id: string;
  leaf_uuid: string;
  text: string;
  ts: number;
};

export type DbTask = {
  id: string;
  workspace_id: string;
  parent_session_id: string | null;
  title: string;
  prompt: string;
  cli: string;
  model: string | null;
  effort: string | null;
  status: "queued" | "running" | "awaiting" | "done" | "failed" | "cancelled";
  worktree_path: string | null;
  branch_name: string | null;
  base_ref: string | null;
  exit_code: number | null;
  error_message: string | null;
  session_id: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
};

export type DbTaskLog = {
  id: number;
  task_id: string;
  ts: number;
  level: string;
  source: string;
  data_json: string;
};

export const DB_DIR = path.join(os.homedir(), ".ide-ux-agentik");
const DB_PATH = path.join(DB_DIR, "data.sqlite");
const BLOBS_DIR = path.join(DB_DIR, "blobs");

let _db: Database.Database | null = null;

function migrateIfNeeded(db: Database.Database): void {
  // Detect ancient schema: messages lacks logical_parent_id → backup + reset
  const msgCols = (db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!msgCols.includes("logical_parent_id")) {
    const bakPath = DB_PATH + ".bak";
    db.close();
    fs.renameSync(DB_PATH, bakPath);
    console.log(`[persistence] schema migration: old db backed up to ${bakPath}`);
    _db = null;
    return;
  }

  // Lightweight ALTER additions for new columns we don't want to reset for.
  const taskCols = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!taskCols.includes("model")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN model TEXT`);
    console.log(`[persistence] migration: added tasks.model`);
  }
  if (!taskCols.includes("effort")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN effort TEXT`);
    console.log(`[persistence] migration: added tasks.effort`);
  }

  // Migration: relax tasks.session_id to nullable (lazy session creation).
  // After the task-centric refactor, sessions are created on first open, not
  // atomically with the task. Detect the legacy strict schema and recreate
  // the tasks table with a nullable session_id.
  const taskTable = db.prepare(`PRAGMA table_info(tasks)`).all() as {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }[];
  const sessionIdCol = taskTable.find((col) => col.name === "session_id");

  if (sessionIdCol && sessionIdCol.notnull === 1) {
    console.info("[persistence] migration: relaxing tasks.session_id to nullable ...");

    db.pragma("foreign_keys = OFF");

    const run = db.transaction(() => {
      db.exec(`
        CREATE TABLE tasks_new (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          parent_session_id TEXT,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          cli TEXT NOT NULL,
          model TEXT,
          effort TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          worktree_path TEXT,
          branch_name TEXT,
          base_ref TEXT,
          exit_code INTEGER,
          error_message TEXT,
          session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          ended_at INTEGER
        )
      `);

      // Explicit column list — old `tasks` may have model/effort at the end
      // (added via earlier ALTER) while tasks_new places them between cli and
      // status. SELECT * would silently misalign columns.
      db.exec(`
        INSERT INTO tasks_new (
          id, workspace_id, parent_session_id, title, prompt, cli, model, effort,
          status, worktree_path, branch_name, base_ref, exit_code, error_message,
          session_id, created_at, started_at, ended_at
        )
        SELECT
          id, workspace_id, parent_session_id, title, prompt, cli,
          model, effort, status, worktree_path, branch_name, base_ref,
          exit_code, error_message, session_id, created_at, started_at, ended_at
        FROM tasks
      `);

      db.exec(`DROP TABLE tasks`);
      db.exec(`ALTER TABLE tasks_new RENAME TO tasks`);

      const logsDeleted = db
        .prepare(`DELETE FROM task_logs WHERE task_id NOT IN (SELECT id FROM tasks)`)
        .run().changes;
      if (logsDeleted > 0) {
        console.info(`[persistence] migration: swept ${logsDeleted} orphaned task_logs rows`);
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status
          ON tasks(workspace_id, status, created_at DESC)
      `);
    });

    try {
      run();
      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `[persistence] migration left FK violations: ${JSON.stringify(violations)}`,
        );
      }
    } finally {
      db.pragma("foreign_keys = ON");
    }
    console.info("[persistence] migration completed: tasks.session_id is now nullable");
  }
}

export function openDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(BLOBS_DIR, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const probe = new Database(DB_PATH);
    migrateIfNeeded(probe);
    // If migrate renamed the file, probe is already closed and _db reset to null
    if (_db) return _db;
  }

  _db = new Database(DB_PATH);
  _db.exec(DDL);
  // Single source-of-truth stamp: regenerated when the DB file is wiped
  // (make db-reset). Clients compare and self-flush their localStorage caches
  // when the stamp changes.
  _db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('db_stamp', ?)`).run(randomUUID());
  console.log(`[persistence] db opened at ${DB_PATH}`);
  return _db;
}

export const metaRepo = {
  getDbStamp(): string {
    const row = openDb().prepare(`SELECT value FROM meta WHERE key = 'db_stamp'`).get() as
      | { value: string }
      | undefined;
    if (!row) throw new Error("meta.db_stamp missing — schema not initialized");
    return row.value;
  },
};

// ─── Org / User / Workspaces (formerly client localStorage) ──────────────────

export type DbOrg = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_at: number;
};

export type DbUser = {
  id: string;
  display_name: string;
  email: string | null;
  default_agent: string;
};

export type DbWorkspaceRow = {
  id: string;
  org_id: string;
  name: string;
  letter: string;
  color: string;
  git_url: string | null;
  root_path: string | null;
  source_kind: string;
  source_url: string | null;
  source_token: string | null;
  source_label: string | null;
  source_handle_id: string | null;
  source_name: string | null;
  created_at: number;
};

export const orgsRepo = {
  /** Single-tenant for now: any insert/upsert overwrites the previous row. */
  get(): DbOrg | null {
    return (openDb().prepare(`SELECT * FROM orgs LIMIT 1`).get() as DbOrg | undefined) ?? null;
  },
  put(org: { id: string; name: string; slug: string; logoUrl?: string; createdAt: number }): DbOrg {
    openDb()
      .prepare(
        `INSERT INTO orgs (id, name, slug, logo_url, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           slug = excluded.slug,
           logo_url = excluded.logo_url`,
      )
      .run(org.id, org.name, org.slug, org.logoUrl ?? null, org.createdAt);
    return this.get()!;
  },
};

export const usersRepo = {
  get(): DbUser | null {
    return (openDb().prepare(`SELECT * FROM users LIMIT 1`).get() as DbUser | undefined) ?? null;
  },
  put(user: { id: string; displayName: string; email?: string; defaultAgent: string }): DbUser {
    openDb()
      .prepare(
        `INSERT INTO users (id, display_name, email, default_agent)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           email = excluded.email,
           default_agent = excluded.default_agent`,
      )
      .run(user.id, user.displayName, user.email ?? null, user.defaultAgent);
    return this.get()!;
  },
};

type WorkspaceUpsertParams = {
  id: string;
  orgId: string;
  name: string;
  letter: string;
  color: string;
  gitUrl?: string;
  rootPath?: string;
  source: {
    kind: string;
    url?: string;
    token?: string;
    label?: string;
    handleId?: string;
    name?: string;
  };
  createdAt?: number;
};

export const workspacesRepo = {
  list(orgId: string): DbWorkspaceRow[] {
    return openDb()
      .prepare(`SELECT * FROM workspaces WHERE org_id = ? ORDER BY created_at ASC`)
      .all(orgId) as DbWorkspaceRow[];
  },
  put(ws: WorkspaceUpsertParams): DbWorkspaceRow {
    const createdAt = ws.createdAt ?? Date.now();
    openDb()
      .prepare(
        `INSERT INTO workspaces (
            id, org_id, name, letter, color, git_url, root_path,
            source_kind, source_url, source_token, source_label,
            source_handle_id, source_name, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            org_id = excluded.org_id,
            name = excluded.name,
            letter = excluded.letter,
            color = excluded.color,
            git_url = excluded.git_url,
            root_path = excluded.root_path,
            source_kind = excluded.source_kind,
            source_url = excluded.source_url,
            source_token = excluded.source_token,
            source_label = excluded.source_label,
            source_handle_id = excluded.source_handle_id,
            source_name = excluded.source_name`,
      )
      .run(
        ws.id,
        ws.orgId,
        ws.name,
        ws.letter,
        ws.color,
        ws.gitUrl ?? null,
        ws.rootPath ?? null,
        ws.source.kind,
        ws.source.url ?? null,
        ws.source.token ?? null,
        ws.source.label ?? null,
        ws.source.handleId ?? null,
        ws.source.name ?? null,
        createdAt,
      );
    return openDb().prepare(`SELECT * FROM workspaces WHERE id = ?`).get(ws.id) as DbWorkspaceRow;
  },
  delete(id: string): { ok: true } {
    openDb().prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
    return { ok: true };
  },
};

export function closeDb(): void {
  if (_db) {
    writeQueue.flush();
    _db.close();
    _db = null;
  }
}

// ─── Write Queue ──────────────────────────────────────────────────────────────
// Batches INSERT rows and flushes them in a single transaction every 100ms.

type QueueEntry =
  | { type: "message"; row: Parameters<typeof _insertMessage>[0] }
  | { type: "session_touch"; row: { id: string; ts: number } };

class WriteQueue {
  private buf: QueueEntry[] = [];
  private timer: NodeJS.Timeout | null = null;

  append(entry: QueueEntry): void {
    this.buf.push(entry);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 100);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buf.length === 0) return;
    const batch = this.buf.splice(0);
    const db = openDb();
    const run = db.transaction(() => {
      for (const entry of batch) {
        if (entry.type === "message") {
          _insertMessage(entry.row);
        } else if (entry.type === "session_touch") {
          db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
            entry.row.ts,
            entry.row.id,
          );
        }
      }
    });
    run();
  }
}

export const writeQueue = new WriteQueue();

// ─── Sessions ─────────────────────────────────────────────────────────────────

type CreateSessionParams = {
  id?: string;
  workspaceId: string;
  cli: string;
  title?: string;
  model?: string;
  approvalMode?: string;
};

type SessionPatch = {
  title?: string;
  model?: string;
  approval_mode?: string;
  status?: string;
};

export const sessionsRepo = {
  create(params: CreateSessionParams): Session {
    const db = openDb();
    const now = Date.now();
    const id = params.id ?? randomUUID();
    db.prepare<
      [string, string, string, string | null, string | null, string | null, number, number]
    >(
      `INSERT OR IGNORE INTO sessions (id, workspace_id, cli, title, model, approval_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      params.workspaceId,
      params.cli,
      params.title ?? null,
      params.model ?? null,
      params.approvalMode ?? null,
      now,
      now,
    );
    return sessionsRepo.getById(id)!;
  },

  list(workspaceId: string): Session[] {
    const db = openDb();
    return db
      .prepare<
        [string],
        Session
      >(`SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC`)
      .all(workspaceId);
  },

  getById(id: string): Session | null {
    const db = openDb();
    return db.prepare<[string], Session>(`SELECT * FROM sessions WHERE id = ?`).get(id) ?? null;
  },

  update(id: string, patch: SessionPatch): Session | null {
    const db = openDb();
    const sets: string[] = ["updated_at = ?"];
    const vals: unknown[] = [Date.now()];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      vals.push(patch.title);
    }
    if (patch.model !== undefined) {
      sets.push("model = ?");
      vals.push(patch.model);
    }
    if (patch.approval_mode !== undefined) {
      sets.push("approval_mode = ?");
      vals.push(patch.approval_mode);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    vals.push(id);
    db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return sessionsRepo.getById(id);
  },

  delete(id: string): void {
    const db = openDb();
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  },
};

// ─── Messages ─────────────────────────────────────────────────────────────────

type AppendMessageParams = {
  sessionId: string;
  role: string;
  parts: unknown[];
  parentId?: string;
  logicalParentId?: string;
  isSidechain?: boolean;
  cwd?: string;
  gitBranch?: string;
  slug?: string;
  version?: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  parent_id: string | null;
  logical_parent_id: string | null;
  is_sidechain: number;
  role: string;
  parts_json: string;
  cwd: string | null;
  git_branch: string | null;
  slug: string | null;
  version: string | null;
  ts: number;
};

function _insertMessage(row: MessageRow): void {
  const db = openDb();
  db.prepare<
    [
      string,
      string,
      string | null,
      string | null,
      number,
      string,
      string,
      string | null,
      string | null,
      string | null,
      string | null,
      number,
    ]
  >(
    `INSERT INTO messages
       (id, session_id, parent_id, logical_parent_id, is_sidechain, role, parts_json,
        cwd, git_branch, slug, version, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.session_id,
    row.parent_id,
    row.logical_parent_id,
    row.is_sidechain,
    row.role,
    row.parts_json,
    row.cwd,
    row.git_branch,
    row.slug,
    row.version,
    row.ts,
  );
}

export const messagesRepo = {
  append(params: AppendMessageParams): string {
    const id = randomUUID();
    const now = Date.now();
    const row: MessageRow = {
      id,
      session_id: params.sessionId,
      parent_id: params.parentId ?? null,
      logical_parent_id: params.logicalParentId ?? null,
      is_sidechain: params.isSidechain ? 1 : 0,
      role: params.role,
      parts_json: JSON.stringify(params.parts),
      cwd: params.cwd ?? null,
      git_branch: params.gitBranch ?? null,
      slug: params.slug ?? null,
      version: params.version ?? null,
      ts: now,
    };
    writeQueue.append({ type: "message", row });
    writeQueue.append({ type: "session_touch", row: { id: params.sessionId, ts: now } });
    return id;
  },

  // Flushes queue then returns the message synchronously — needed for RPC callers that return the row.
  appendSync(params: AppendMessageParams): Message {
    const id = this.append(params);
    writeQueue.flush();
    const db = openDb();
    return db.prepare<[string], Message>(`SELECT * FROM messages WHERE id = ?`).get(id)!;
  },

  list({
    sessionId,
    limit = 50,
    beforeTs,
  }: {
    sessionId: string;
    limit?: number;
    beforeTs?: number;
  }): Message[] {
    const db = openDb();
    if (beforeTs !== undefined) {
      const rows = db
        .prepare<[string, number, number], Message>(
          `SELECT * FROM messages WHERE session_id = ? AND ts < ?
           ORDER BY ts DESC LIMIT ?`,
        )
        .all(sessionId, beforeTs, limit);
      return rows.reverse();
    }
    const rows = db
      .prepare<
        [string, number],
        Message
      >(`SELECT * FROM messages WHERE session_id = ? ORDER BY ts DESC LIMIT ?`)
      .all(sessionId, limit);
    return rows.reverse();
  },

  // Kept for internal use (import-codex, etc.)
  listBySession(sessionId: string): Message[] {
    const db = openDb();
    return db
      .prepare<[string], Message>(`SELECT * FROM messages WHERE session_id = ? ORDER BY ts`)
      .all(sessionId);
  },
};

// ─── Blobs ────────────────────────────────────────────────────────────────────

function blobPath(hash: string): string {
  return path.join(BLOBS_DIR, hash);
}

function writeBlob(content: string): string {
  const buf = Buffer.from(content, "utf8");
  const hash = createHash("sha256").update(buf).digest("hex");
  const dest = blobPath(hash);
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, buf);
    // fsync the file so the blob is durable before the DB row is committed
    const fd = fs.openSync(dest, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const db = openDb();
    db.prepare<[string, number, number]>(
      `INSERT OR IGNORE INTO file_blobs (id, size, ts) VALUES (?, ?, ?)`,
    ).run(hash, buf.byteLength, Date.now());
  }
  return hash;
}

export const blobsRepo = {
  write: writeBlob,

  read(hash: string): Buffer | null {
    const p = blobPath(hash);
    try {
      return fs.readFileSync(p);
    } catch {
      return null;
    }
  },
};

// ─── Snapshots ────────────────────────────────────────────────────────────────

type AddSnapshotParams = {
  sessionId: string;
  messageId?: string;
  path: string;
  contentBefore?: string;
  contentAfter?: string;
};

export const snapshotsRepo = {
  add(params: AddSnapshotParams): FileSnapshot {
    const db = openDb();
    const id = randomUUID();
    const now = Date.now();
    const beforeHash = params.contentBefore !== undefined ? writeBlob(params.contentBefore) : null;
    const afterHash = params.contentAfter !== undefined ? writeBlob(params.contentAfter) : null;
    db.prepare<[string, string, string | null, string, string | null, string | null, number]>(
      `INSERT INTO file_snapshots
         (id, session_id, message_id, path, content_before_hash, content_after_hash, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, params.sessionId, params.messageId ?? null, params.path, beforeHash, afterHash, now);
    return db.prepare<[string], FileSnapshot>(`SELECT * FROM file_snapshots WHERE id = ?`).get(id)!;
  },

  listBySession(sessionId: string): FileSnapshot[] {
    const db = openDb();
    return db
      .prepare<
        [string],
        FileSnapshot
      >(`SELECT * FROM file_snapshots WHERE session_id = ? ORDER BY ts`)
      .all(sessionId);
  },

  readBlob(hash: string): Buffer | null {
    return blobsRepo.read(hash);
  },
};

// ─── Summaries ────────────────────────────────────────────────────────────────

type AddSummaryParams = {
  sessionId: string;
  leafUuid: string;
  text: string;
};

export const summariesRepo = {
  add(params: AddSummaryParams): Summary {
    const db = openDb();
    const now = Date.now();
    const stmt = db.prepare<[string, string, string, number]>(
      `INSERT INTO summaries (session_id, leaf_uuid, text, ts) VALUES (?, ?, ?, ?)`,
    );
    const info = stmt.run(params.sessionId, params.leafUuid, params.text, now);
    return db
      .prepare<[number | bigint], Summary>(`SELECT * FROM summaries WHERE id = ?`)
      .get(info.lastInsertRowid)!;
  },

  listBySession(sessionId: string): Summary[] {
    const db = openDb();
    return db
      .prepare<[string], Summary>(`SELECT * FROM summaries WHERE session_id = ? ORDER BY ts DESC`)
      .all(sessionId);
  },
};

// ─── Tasks ────────────────────────────────────────────────────────────────────

type CreateTaskParams = {
  id: string;
  workspaceId: string;
  parentSessionId?: string;
  title: string;
  prompt: string;
  cli: string;
  model?: string;
  effort?: string;
  baseRef?: string;
};

export const tasksRepo = {
  create(params: CreateTaskParams): DbTask {
    const db = openDb();
    const now = Date.now();
    db.prepare<
      [string, string, string | null, string, string, string, string | null, string | null, number]
    >(
      `INSERT INTO tasks (id, workspace_id, parent_session_id, title, prompt, cli, model, effort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.id,
      params.workspaceId,
      params.parentSessionId ?? null,
      params.title,
      params.prompt,
      params.cli,
      params.model ?? null,
      params.effort ?? null,
      now,
    );
    return tasksRepo.get(params.id)!;
  },

  get(id: string): DbTask | null {
    const db = openDb();
    return db.prepare<[string], DbTask>(`SELECT * FROM tasks WHERE id = ?`).get(id) ?? null;
  },

  list(workspaceId: string, opts?: { status?: DbTask["status"]; limit?: number }): DbTask[] {
    const db = openDb();
    const limit = opts?.limit ?? 100;
    if (opts?.status) {
      return db
        .prepare<[string, string, number], DbTask>(
          `SELECT * FROM tasks
           WHERE workspace_id = ? AND status = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(workspaceId, opts.status, limit);
    }
    return db
      .prepare<
        [string, number],
        DbTask
      >(`SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(workspaceId, limit);
  },

  update(
    id: string,
    patch: Partial<
      Pick<
        DbTask,
        | "status"
        | "worktree_path"
        | "branch_name"
        | "base_ref"
        | "exit_code"
        | "error_message"
        | "session_id"
        | "started_at"
        | "ended_at"
      >
    >,
  ): void {
    const db = openDb();
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (patch.status !== undefined) {
      sets.push("status = ?");
      vals.push(patch.status);
    }
    if (patch.worktree_path !== undefined) {
      sets.push("worktree_path = ?");
      vals.push(patch.worktree_path);
    }
    if (patch.branch_name !== undefined) {
      sets.push("branch_name = ?");
      vals.push(patch.branch_name);
    }
    if (patch.base_ref !== undefined) {
      sets.push("base_ref = ?");
      vals.push(patch.base_ref);
    }
    if (patch.exit_code !== undefined) {
      sets.push("exit_code = ?");
      vals.push(patch.exit_code);
    }
    if (patch.error_message !== undefined) {
      sets.push("error_message = ?");
      vals.push(patch.error_message);
    }
    if (patch.session_id !== undefined) {
      sets.push("session_id = ?");
      vals.push(patch.session_id);
    }
    if (patch.started_at !== undefined) {
      sets.push("started_at = ?");
      vals.push(patch.started_at);
    }
    if (patch.ended_at !== undefined) {
      sets.push("ended_at = ?");
      vals.push(patch.ended_at);
    }

    if (sets.length === 0) return;
    vals.push(id);
    db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  },

  delete(id: string): void {
    const db = openDb();
    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  },
};

// ─── Task Logs ────────────────────────────────────────────────────────────────

export const taskLogsRepo = {
  append(taskId: string, level: string, source: string, data: unknown): void {
    const db = openDb();
    const now = Date.now();
    db.prepare<[string, number, string, string, string]>(
      `INSERT INTO task_logs (task_id, ts, level, source, data_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(taskId, now, level, source, JSON.stringify(data));
  },

  list(taskId: string, opts?: { since?: number; limit?: number }): DbTaskLog[] {
    const db = openDb();
    const limit = opts?.limit ?? 1000;

    if (opts?.since !== undefined) {
      return db
        .prepare<[string, number, number], DbTaskLog>(
          `SELECT * FROM task_logs WHERE task_id = ? AND ts >= ?
           ORDER BY ts LIMIT ?`,
        )
        .all(taskId, opts.since, limit);
    }

    return db
      .prepare<
        [string, number],
        DbTaskLog
      >(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY ts LIMIT ?`)
      .all(taskId, limit);
  },
};
