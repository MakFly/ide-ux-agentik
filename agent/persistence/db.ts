import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DDL } from "./schema.js";

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

export const DB_DIR = path.join(os.homedir(), ".ide-ux-agentik");
const DB_PATH = path.join(DB_DIR, "data.sqlite");
const BLOBS_DIR = path.join(DB_DIR, "blobs");

let _db: Database.Database | null = null;

function migrateIfNeeded(db: Database.Database): void {
  // Detect old schema: messages lacks logical_parent_id
  const cols = (db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (cols.includes("logical_parent_id")) return;

  const bakPath = DB_PATH + ".bak";
  db.close();
  fs.renameSync(DB_PATH, bakPath);
  console.log(`[persistence] schema migration: old db backed up to ${bakPath}`);
  _db = null;
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
  console.log(`[persistence] db opened at ${DB_PATH}`);
  return _db;
}

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
    const id = randomUUID();
    db.prepare<[string, string, string, string | null, string | null, string | null, number, number]>(
      `INSERT INTO sessions (id, workspace_id, cli, title, model, approval_mode, created_at, updated_at)
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
      .prepare<[string], Session>(
        `SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC`,
      )
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
  db.prepare<[string, string, string | null, string | null, number, string, string, string | null, string | null, string | null, string | null, number]>(
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
      .prepare<[string, number], Message>(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY ts DESC LIMIT ?`,
      )
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
    return db
      .prepare<[string], FileSnapshot>(`SELECT * FROM file_snapshots WHERE id = ?`)
      .get(id)!;
  },

  listBySession(sessionId: string): FileSnapshot[] {
    const db = openDb();
    return db
      .prepare<[string], FileSnapshot>(
        `SELECT * FROM file_snapshots WHERE session_id = ? ORDER BY ts`,
      )
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
      .prepare<[string], Summary>(
        `SELECT * FROM summaries WHERE session_id = ? ORDER BY ts DESC`,
      )
      .all(sessionId);
  },
};
