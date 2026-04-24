/**
 * Typed RPC wrappers for the agent persistence methods.
 * Requires a connected RemoteAgentProvider passed at call-time so the caller
 * can always use the workspace's own agent connection.
 */
import type { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import type {
  AddSnapshotInput,
  AddSummaryInput,
  AppendMessageInput,
  CreateSessionInput,
  DbMessage,
  DbSession,
  DbSnapshot,
  DbSummary,
  ListMessagesInput,
  UpdateSessionInput,
} from "./types";

function rpc<T>(provider: RemoteAgentProvider, method: string, params: unknown): Promise<T> {
  return provider.call<T>(method, params);
}

export const persistence = {
  sessions: {
    list(provider: RemoteAgentProvider, workspaceId: string): Promise<DbSession[]> {
      return rpc<DbSession[]>(provider, "sessions.list", { workspaceId });
    },
    create(provider: RemoteAgentProvider, input: CreateSessionInput): Promise<DbSession> {
      return rpc<DbSession>(provider, "sessions.create", input);
    },
    update(provider: RemoteAgentProvider, input: UpdateSessionInput): Promise<DbSession> {
      return rpc<DbSession>(provider, "sessions.update", input);
    },
    delete(provider: RemoteAgentProvider, id: string): Promise<{ ok: true }> {
      return rpc<{ ok: true }>(provider, "sessions.delete", { id });
    },
  },
  messages: {
    list(provider: RemoteAgentProvider, input: ListMessagesInput | string): Promise<DbMessage[]> {
      // Accept plain sessionId string for backwards compatibility
      const params = typeof input === "string" ? { sessionId: input } : input;
      return rpc<DbMessage[]>(provider, "messages.list", params);
    },
    append(provider: RemoteAgentProvider, input: AppendMessageInput): Promise<DbMessage> {
      return rpc<DbMessage>(provider, "messages.append", input);
    },
    deleteForSession(provider: RemoteAgentProvider, sessionId: string): Promise<{ ok: true }> {
      return rpc<{ ok: true }>(provider, "messages.deleteForSession", { sessionId });
    },
  },
  snapshots: {
    add(provider: RemoteAgentProvider, input: AddSnapshotInput): Promise<DbSnapshot> {
      return rpc<DbSnapshot>(provider, "snapshots.add", input);
    },
    readBlob(
      provider: RemoteAgentProvider,
      hash: string,
    ): Promise<{ hash: string; size: number; content: string }> {
      return rpc(provider, "snapshots.readBlob", { hash });
    },
  },
  summaries: {
    add(provider: RemoteAgentProvider, input: AddSummaryInput): Promise<DbSummary> {
      return rpc<DbSummary>(provider, "summaries.add", input);
    },
    list(provider: RemoteAgentProvider, sessionId: string): Promise<DbSummary[]> {
      return rpc<DbSummary[]>(provider, "summaries.list", { sessionId });
    },
  },
};
