import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { useIDE } from "@/store/ide";

export type GitFileEntry = {
  path: string;
  staged: boolean;
  unstaged: boolean;
  kind: string;
};

export type GitStatusResult = {
  branch: string;
  files: GitFileEntry[];
};

// The agent exposes root via the HTTP health probe (GET → { root }).
async function fetchAgentRoot(url: string): Promise<string> {
  const httpUrl = url.replace(/^wss?:\/\//, "http://").replace(/\/+$/, "");
  const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`Agent probe failed: ${resp.status}`);
  const json = (await resp.json()) as { root?: string };
  if (!json.root) throw new Error("Agent probe did not return root");
  return json.root;
}

async function resolve(): Promise<{ provider: RemoteAgentProvider; workspacePath: string }> {
  const state = useIDE.getState();
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (!ws) throw new Error("No active workspace");
  if (ws.source.kind !== "remote-agent")
    throw new Error("Active workspace is not a remote-agent workspace");

  const provider = (await providerFor(ws.source, ws.source.label)) as RemoteAgentProvider;
  const activeThread = state.selectActiveAgentThread(ws.id);
  const workspacePath =
    activeThread?.worktreePath ?? ws.rootPath ?? (await fetchAgentRoot(ws.source.url));
  return { provider, workspacePath };
}

export const gitClient = {
  async status(): Promise<GitStatusResult> {
    const { provider, workspacePath } = await resolve();
    return provider.gitStatus(workspacePath);
  },

  async stage(paths: string[]): Promise<{ ok: boolean }> {
    const { provider, workspacePath } = await resolve();
    return provider.gitStage(workspacePath, paths);
  },

  async commit(message: string): Promise<{ sha: string | null; message: string }> {
    const { provider, workspacePath } = await resolve();
    return provider.gitCommit(workspacePath, message);
  },

  async diff(staged = false): Promise<{ patch: string }> {
    const { provider, workspacePath } = await resolve();
    return provider.gitDiff(workspacePath, staged);
  },
};
