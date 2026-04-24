export const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  cli TEXT NOT NULL,
  title TEXT,
  model TEXT,
  approval_mode TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle'
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace
  ON sessions(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id TEXT,
  logical_parent_id TEXT,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL,
  parts_json TEXT NOT NULL,
  cwd TEXT,
  git_branch TEXT,
  slug TEXT,
  version TEXT,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages(session_id, ts);

CREATE INDEX IF NOT EXISTS idx_messages_logical_parent
  ON messages(logical_parent_id) WHERE logical_parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS file_blobs (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id),
  path TEXT NOT NULL,
  content_before_hash TEXT REFERENCES file_blobs(id),
  content_after_hash TEXT REFERENCES file_blobs(id),
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_session
  ON file_snapshots(session_id, ts);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  leaf_uuid TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_session
  ON summaries(session_id, ts DESC);
`;
