export type DbSession = {
  id: string;
  workspace_id: string;
  cli: string;
  title: string | null;
  model: string | null;
  approval_mode: string | null;
  mode: "chat" | "terminal";
  created_at: number;
  updated_at: number;
  status: string;
};

export type DbMessage = {
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

export type DbSnapshot = {
  id: string;
  session_id: string;
  message_id: string | null;
  path: string;
  content_before_hash: string | null;
  content_after_hash: string | null;
  ts: number;
};

export type DbSummary = {
  id: number;
  session_id: string;
  leaf_uuid: string;
  text: string;
  ts: number;
};

export type DbFileBlob = {
  id: string;
  size: number;
  ts: number;
};

export type CreateSessionInput = {
  id?: string;
  workspaceId: string;
  cli: string;
  title?: string;
  model?: string;
  approvalMode?: string;
  mode?: "chat" | "terminal";
};

export type UpdateSessionInput = {
  id: string;
  patch: {
    title?: string;
    model?: string;
    approval_mode?: string;
    status?: string;
    mode?: "chat" | "terminal";
  };
};

export type AppendMessageInput = {
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

export type ListMessagesInput = {
  sessionId: string;
  limit?: number;
  beforeTs?: number;
};

export type AddSnapshotInput = {
  sessionId: string;
  messageId?: string;
  path: string;
  contentBefore?: string;
  contentAfter?: string;
};

export type AddSummaryInput = {
  sessionId: string;
  leafUuid: string;
  text: string;
};
