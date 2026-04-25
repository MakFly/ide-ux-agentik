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

CREATE TABLE IF NOT EXISTS tasks (
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
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status
  ON tasks(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_parent_session_id
  ON tasks(parent_session_id) WHERE parent_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, ts);
`;
