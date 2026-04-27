import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
  params?: unknown;
};

type TestTask = {
  id: string;
  status: string;
  cli?: "codex" | "claude";
};

type StoreSession = {
  id: string;
  kind: string;
  taskRootId?: string;
  taskId?: string;
};

type BrowserTestStore = {
  activeWorkspaceId?: string | null;
  activeTaskId?: string | null;
  workspaces?: Array<{ id: string; source?: unknown }>;
  tasksByWorkspaceId?: Record<string, TestTask[]>;
  taskEventsByTaskId?: Record<string, Array<{ data: unknown }>>;
  sessionsByWorkspaceId?: Record<string, StoreSession[]>;
  composerAgentByWorkspaceId?: Record<string, "codex" | "claude">;
  createTaskFromPrompt?: (
    prompt: string,
    options: { cli: "codex" | "claude" },
  ) => Promise<Partial<TestTask>>;
  setActiveWorkspace?: (id: string) => void;
  setComposerAgent?: (id: string, cli: "codex" | "claude") => void;
  setActiveTask?: (id: string) => void;
  setActiveSession?: (id: string) => void;
  closeSessionTab?: (id: string) => void;
};

type BrowserTestWindow = Window & {
  __test?: { getStore?: () => BrowserTestStore };
  __AGENT__?: { url: string; token: string; label?: string };
};

const AGENT_PORT = 7605;
const AGENT_TOKEN = process.env.E2E_AGENT_TOKEN ?? randomUUID();
const AGENT_BASE_URL = `ws://127.0.0.1:${AGENT_PORT}`;
const WARNING_MARKER = "codex_core::session: failed to record rollout items: thread";

const CLI_OPTIONS: Array<{
  cli: "codex" | "claude";
  label: string;
  welcomeButtonName: string;
}> = [
  {
    cli: "codex",
    label: "codex",
    welcomeButtonName: "Codex",
  },
  {
    cli: "claude",
    label: "claude",
    welcomeButtonName: "Claude",
  },
];

class AgentRpcClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private connectInFlight: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private static normalizeData(data: unknown): string {
    if (typeof data === "string") return data;
    if (data instanceof Blob) {
      return "[blob]";
    }
    return String(data);
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectInFlight) return this.connectInFlight;

    this.connectInFlight = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error(`agent ws timeout: ${this.url}`));
      }, 20_000);

      const cleanup = (err?: Error) => {
        clearTimeout(timer);
        this.connectInFlight = null;
        if (err) {
          ws.close();
          reject(err);
        } else {
          resolve();
        }
      };

      ws.addEventListener("open", async () => {
        try {
          await this.call("auth", { token: this.token });
          cleanup();
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          cleanup(e);
        }
      });

      ws.addEventListener("error", () => {
        cleanup(new Error(`cannot reach agent at ${this.url}`));
      });

      ws.addEventListener("close", () => {
        this.pending.forEach((entry) => entry.reject(new Error("agent websocket closed")));
        this.pending.clear();
      });

      ws.addEventListener("message", (ev: MessageEvent<string>) => {
        const raw = AgentRpcClient.normalizeData(ev.data);
        try {
          const msg = JSON.parse(raw) as JsonRpcMessage;
          if (msg.id === undefined) return;
          const pending = this.pending.get(msg.id);
          if (!pending) return;
          this.pending.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message ?? "rpc error"));
            return;
          }
          pending.resolve(msg.result);
        } catch {
          return;
        }
      });
    });

    await this.connectInFlight;
  }

  async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("agent websocket is not connected");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    ws.send(payload);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.pending.forEach((entry) => entry.reject(new Error("agent websocket closed")));
    this.pending.clear();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildFakeCliScript(
  runtimeMarker: string,
  emitWarning: boolean,
  options: { failResumeForPrompt?: string; staleResumeMessage?: string } = {},
): string {
  const failResumeForPrompt = options.failResumeForPrompt ?? null;
  const staleResumeMessage =
    options.staleResumeMessage ?? "No conversation found with session ID: {sessionId}";
  return `#!/usr/bin/env node
const fs = require("node:fs");
const rustLog = process.env.RUST_LOG || "";
const doneDelayMs = Number(process.env.TASK_RUN_MS || 0);
const args = process.argv.slice(2);
const marker = "${runtimeMarker}";
const promptArgIndex = args.indexOf("-p");
const promptArg = promptArgIndex >= 0 ? String(args[promptArgIndex + 1] || "") : "";
function readResumeSessionId() {
  const namedFlags = ["--resume", "-r", "--session"];
  for (const flag of namedFlags) {
    const index = args.indexOf(flag);
    if (index >= 0) return String(args[index + 1] || "");
  }
  const resumeCommandIndex = args.indexOf("resume");
  if (resumeCommandIndex >= 0) {
    const stdinDashIndex = args.lastIndexOf("-");
    if (stdinDashIndex > resumeCommandIndex) return String(args[stdinDashIndex - 1] || "");
  }
  return "";
}
const resumeSessionId = readResumeSessionId();
let stdinPrompt = "";
try {
  stdinPrompt = String(fs.readFileSync(0, "utf8"));
} catch {}
const prompt = String(promptArg || stdinPrompt).trim();
if (${JSON.stringify(failResumeForPrompt)} && resumeSessionId && prompt.includes(${JSON.stringify(failResumeForPrompt)})) {
  console.error(${JSON.stringify(staleResumeMessage)}.replace("{sessionId}", resumeSessionId));
  process.exit(1);
}
if (${emitWarning ? "true" : "false"}) {
  if (${runtimeMarker ? `"${runtimeMarker}"` : '""'} && !String(rustLog).includes("codex_core::session=off")) {
  console.error("${WARNING_MARKER}: " + String(${runtimeMarker || "000"}));
  }
}
const emit = (obj) => {
  process.stdout.write(String(JSON.stringify(obj)) + "\\n");
};
emit({ type: "thread.started", session_id: marker });
emit({ type: "turn.started" });
emit({ type: "assistant_message", text: "Mock response for " + (prompt || "task") });
if (Number.isFinite(doneDelayMs) && doneDelayMs > 0) {
  setTimeout(() => emit({ type: "turn.completed" }), doneDelayMs);
} else {
  emit({ type: "turn.completed" });
}
`;
}

let agentProcess: ChildProcess | null = null;
let tmpRoot: string | null = null;
let fakeBinDir: string | null = null;
let client: AgentRpcClient | null = null;

async function waitForAgent(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${AGENT_PORT}`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error("agent did not become ready");
}

async function readTaskStatus(workspaceId: string, taskId: string): Promise<string> {
  if (!client) throw new Error("rpc client is not initialized");
  const tasks = await client.call<Array<{ id: string; status: string }>>("task.list", {
    workspaceId,
  });
  return tasks.find((task) => task.id === taskId)?.status ?? "missing";
}

async function readTaskFromStore(
  page: import("@playwright/test").Page,
  taskId: string,
): Promise<{ id: string; status: string } | null> {
  return page.evaluate((id) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    if (!store) return null;
    for (const tasks of Object.values(store.tasksByWorkspaceId || {})) {
      const match = (tasks ?? []).find((task: { id: string; status: string }) => task.id === id);
      if (match) {
        return { id: match.id, status: match.status };
      }
    }
    return null;
  }, taskId);
}

async function readTurnCompletedFromStore(page: import("@playwright/test").Page, taskId: string) {
  return page.evaluate((tid) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    if (!store) return false;
    const events = (store.taskEventsByTaskId?.[tid] ?? []) as unknown[];
    return events.some((evt: unknown) => {
      const raw = evt as { data?: unknown };
      const data = raw?.data;
      return (
        data && typeof data === "object" && (data as { type?: unknown }).type === "turn.completed"
      );
    });
  }, taskId);
}

async function readTaskLogsFromStore(
  page: import("@playwright/test").Page,
  taskId: string,
): Promise<Array<{ data: unknown }>> {
  return page.evaluate((tid) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    const entries = (store?.taskEventsByTaskId?.[tid] ?? []) as Array<{ data: unknown }>;
    return entries;
  }, taskId);
}

async function waitForTaskStatus(
  page: import("@playwright/test").Page,
  workspaceId: string,
  taskId: string,
  status: string,
  timeoutMs = 12_000,
) {
  await expect
    .poll(
      async () => {
        const remoteStatus = await readTaskStatus(workspaceId, taskId).catch(() => null);
        if (remoteStatus === status) return remoteStatus;

        const localTask = await readTaskFromStore(page, taskId);
        if (localTask?.status === status) return localTask.status;

        const hasTurnCompleted = await readTurnCompletedFromStore(page, taskId);
        if (status === "done" && hasTurnCompleted) {
          return "done";
        }

        if (remoteStatus) return remoteStatus;
        return "missing";
      },
      { timeout: timeoutMs },
    )
    .toBe(status);
}

function parseTaskLogData(row: { data?: unknown; data_json?: unknown }): unknown {
  if (row.data !== undefined) return row.data;
  if (typeof row.data_json !== "string") return row.data_json;
  try {
    return JSON.parse(row.data_json);
  } catch {
    return { type: "raw", text: row.data_json };
  }
}

async function readTaskLogs(taskId: string) {
  if (!client) throw new Error("rpc client is not initialized");
  const rows = await client.call<Array<{ data?: unknown; data_json?: unknown; source?: string }>>(
    "task.logs.list",
    { taskId },
  );
  return rows.map((row) => ({ ...row, data: parseTaskLogData(row) }));
}

async function readTaskLogsSafe(page: import("@playwright/test").Page, taskId: string) {
  const rpcLogs = await readTaskLogs(taskId).catch(() => []);
  const storeLogs = await readTaskLogsFromStore(page, taskId).catch(() => []);
  return [...rpcLogs, ...storeLogs];
}

async function createTasksViaStore(
  page: import("@playwright/test").Page,
  workspaceId: string,
  requests: Array<{ cli: "codex" | "claude"; prompt: string }>,
): Promise<Array<{ id: string; cli: "codex" | "claude"; status: string }>> {
  return page.evaluate(
    (input) => {
      const { activeWorkspaceId, items } = input;
      const store = (window as BrowserTestWindow).__test?.getStore?.();
      if (!store) throw new Error("store unavailable");
      if (!store.createTaskFromPrompt) throw new Error("createTaskFromPrompt is unavailable");
      if (String(store.activeWorkspaceId ?? "") !== String(activeWorkspaceId)) {
        throw new Error(
          `active workspace mismatch: expected ${activeWorkspaceId}, got ${store.activeWorkspaceId}`,
        );
      }

      return Promise.all(
        (items as Array<{ cli: "codex" | "claude"; prompt: string }>).map(async (entry) => {
          const task = await store.createTaskFromPrompt!(entry.prompt, {
            cli: entry.cli,
          });
          if (!task?.id) {
            throw new Error("createTaskFromPrompt did not return task id");
          }
          return {
            id: task.id as string,
            cli: entry.cli,
            status: (task.status ?? "queued") as string,
          };
        }),
      );
    },
    { activeWorkspaceId: workspaceId, items: requests },
  );
}

function dataToText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "text" in (data as { text?: unknown })) {
    const txt = (data as { text?: unknown }).text;
    if (typeof txt === "string") return txt;
  }
  const serialized = JSON.stringify(data);
  return serialized === undefined ? String(data) : serialized;
}

async function createTestOrgAndWorkspace() {
  if (!client) throw new Error("rpc client is not initialized");
  const currentOrg = await client.call<{ id: string } | null>("org.get", {});
  const targetOrgId = currentOrg?.id ?? crypto.randomUUID();
  if (!currentOrg?.id) {
    const createdOrg = await client.call<{ id: string }>("org.put", {
      org: {
        id: targetOrgId,
        name: `e2e-org-${targetOrgId.slice(0, 6)}`,
        slug: `e2e-org-${targetOrgId.slice(0, 6)}`,
        createdAt: Date.now(),
      },
    });
    console.log("[agent state] created org", createdOrg.id);
  }
  const orgId = targetOrgId;
  const workspaceId = crypto.randomUUID();
  await client.call("workspaces.put", {
    workspace: {
      id: workspaceId,
      orgId,
      name: "e2e-workspace",
      letter: "E",
      color: "#3b82f6",
      source: {
        kind: "remote-agent",
        url: AGENT_BASE_URL,
        token: AGENT_TOKEN,
        label: "e2e-live",
      },
    },
  });
  return { orgId, workspaceId };
}

async function setTestEndpointInBrowser(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ url, token }) => {
      window.localStorage.setItem(
        "agentik.global-agent.endpoint.v1",
        JSON.stringify({ url, token, label: "e2e-local-agent" }),
      );
      (window as BrowserTestWindow).__AGENT__ = {
        url,
        token,
        label: "e2e-local-agent",
      };
    },
    { url: `ws://127.0.0.1:${AGENT_PORT}`, token: AGENT_TOKEN },
  );
}

async function waitForActiveWorkspaceInStore(
  page: import("@playwright/test").Page,
  workspaceId: string,
  timeoutMs = 20_000,
) {
  await expect
    .poll(
      async () => {
        return page.evaluate((id) => {
          const store = (window as BrowserTestWindow).__test?.getStore?.();
          return (
            store?.workspaces?.some((workspace: { id: string }) => workspace.id === id) ?? false
          );
        }, workspaceId);
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
}

async function setActiveWorkspaceInStore(
  page: import("@playwright/test").Page,
  workspaceId: string,
) {
  await waitForActiveWorkspaceInStore(page, workspaceId);
  await page.evaluate((id) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    if (!store) return;
    if (store.activeWorkspaceId !== id) {
      store.setActiveWorkspace?.(id);
    }
  }, workspaceId);

  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const store = (window as BrowserTestWindow).__test?.getStore?.();
          return store?.activeWorkspaceId === id;
        }, workspaceId),
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function ensureComposerAgent(
  page: import("@playwright/test").Page,
  workspaceId: string,
  cli: "codex" | "claude",
  welcomeButtonName: string,
) {
  const welcomeButton = page.getByRole("button", { name: welcomeButtonName });
  if (await welcomeButton.isVisible().catch(() => false)) {
    await welcomeButton.click();
    return;
  }

  const selected = await page.evaluate(
    ({ id, cliId }) => {
      const store = (window as BrowserTestWindow).__test?.getStore?.();
      return store?.composerAgentByWorkspaceId?.[id] === cliId;
    },
    { id: workspaceId, cliId: cli },
  );
  if (!selected) {
    await page.evaluate(
      ({ id, cliId }) => {
        const store = (window as BrowserTestWindow).__test?.getStore?.();
        if (!store) return;
        store.setComposerAgent?.(id, cliId);
      },
      { id: workspaceId, cliId: cli },
    );
  }
}

async function ensureActiveTaskInStore(page: import("@playwright/test").Page, taskId: string) {
  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const store = (window as BrowserTestWindow).__test?.getStore?.();
          return (
            !!store?.tasksByWorkspaceId &&
            Object.values(store.tasksByWorkspaceId).some((tasks) =>
              tasks.some((task) => task.id === id),
            )
          );
        }, taskId),
      { timeout: 10_000 },
    )
    .toBeTruthy();

  await page.evaluate((id) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    store?.setActiveTask?.(id);
  }, taskId);

  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const store = (window as BrowserTestWindow).__test?.getStore?.();
          return store?.activeTaskId === id;
        }, taskId),
      { timeout: 10_000 },
    )
    .toBeTruthy();
}

async function getActiveTaskId(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    return store?.activeTaskId ?? null;
  });
}

async function listWorkspaceSessions(
  page: import("@playwright/test").Page,
  workspaceId: string,
): Promise<StoreSession[]> {
  return page.evaluate((id) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    return store?.sessionsByWorkspaceId?.[id] ?? [];
  }, workspaceId);
}

async function closeSessionTabInPage(page: import("@playwright/test").Page, sessionId: string) {
  await page.evaluate((sid) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    if (!store) return;
    store.closeSessionTab?.(sid);
  }, sessionId);
}

async function openNewCliFromHeader(page: import("@playwright/test").Page, cliName: string) {
  const addButton = page.getByRole("button", { name: "Add CLI" });
  if (await addButton.isVisible().catch(() => false)) {
    await addButton.click();
  } else {
    const startButton = page.getByRole("button", { name: "Start a new CLI" });
    await startButton.click();
  }
  await page
    .getByRole("menuitem")
    .filter({ hasText: new RegExp(`^${cliName}\\b`, "i") })
    .first()
    .click();
}

async function readAgentSessionsFromRpc(workspaceId: string) {
  if (!client) throw new Error("rpc client is not initialized");
  return client.call<Array<{ id: string }>>("sessions.list", { workspaceId });
}

async function waitForActiveTask(page: import("@playwright/test").Page, timeoutMs = 20_000) {
  await expect
    .poll(
      async () => {
        const taskId = await getActiveTaskId(page);
        return !!taskId;
      },
      { timeout: timeoutMs },
    )
    .toBeTruthy();

  const taskId = await getActiveTaskId(page);
  if (!taskId) throw new Error("active task id is still missing");
  return String(taskId);
}

async function createAndFinishFirstPrompt(
  page: import("@playwright/test").Page,
  scenario: (typeof CLI_OPTIONS)[number],
  orgId: string,
  workspaceId: string,
) {
  await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
  const debugState = await page.evaluate(() => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    const endpoint = window.localStorage.getItem("agentik.global-agent.endpoint.v1");
    return {
      location: location.pathname + location.search,
      title: document.title,
      bodyText: document.body?.textContent?.slice(0, 260) ?? "",
      activeWorkspaceId: store?.activeWorkspaceId ?? null,
      workspaceCount: store?.workspaces?.length ?? 0,
      workspaceIds: store?.workspaces?.map((workspace: { id: string }) => workspace.id) ?? [],
      activeTaskId: store?.activeTaskId ?? null,
      workspaceTasks: Object.fromEntries(
        Object.entries(store?.tasksByWorkspaceId ?? {}).map(([id, tasks]) => [id, tasks.length]),
      ),
      endpoint,
    };
  });
  console.log("[task-continue debug]", {
    orgId,
    workspaceId,
    ...debugState,
  });
  await setActiveWorkspaceInStore(page, workspaceId);
  await ensureComposerAgent(page, workspaceId, scenario.cli, scenario.welcomeButtonName);
  await page.getByTestId("chat-composer-input").waitFor({ timeout: 10_000 });
  await page.getByTestId("chat-composer-input").fill(`seed prompt for ${scenario.cli} flow`);
  await page.getByRole("button", { name: "Send message" }).click();
  const debugWorkspaceSource = await page.evaluate(() => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    const activeWorkspace = store?.workspaces?.find(
      (w: { id: string }) => w.id === store.activeWorkspaceId,
    );
    return {
      activeWorkspaceId: store?.activeWorkspaceId ?? null,
      source: activeWorkspace?.source ?? null,
    };
  });
  console.log("[task-continue source]", debugWorkspaceSource);
  const postSendState = await page.evaluate((id) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    return {
      activeWorkspaceId: store?.activeWorkspaceId,
      activeTaskId: store?.activeTaskId,
      taskCountByWorkspace: Object.fromEntries(
        Object.entries(store?.tasksByWorkspaceId ?? {}).map(([workspaceId, tasks]) => [
          workspaceId,
          tasks.length,
        ]),
      ),
    };
  }, workspaceId);
  console.log("[task-continue post-send]", postSendState);
  const taskId = await waitForActiveTask(page);
  const typedTaskId = String(taskId);
  await waitForTaskStatus(page, workspaceId, typedTaskId, "done");

  return { taskId: typedTaskId };
}

async function sendFollowUpAndAwaitDone(
  page: import("@playwright/test").Page,
  workspaceId: string,
  taskId: string,
  prompt: string,
) {
  await page.getByTestId("chat-composer-input").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await waitForTaskStatus(page, workspaceId, taskId, "done");
  await expect(page.getByTestId("chat-composer-stop")).not.toBeVisible({ timeout: 10_000 });
}

async function sendFollowUpFromComposer(page: import("@playwright/test").Page, prompt: string) {
  await page.getByTestId("chat-composer-input").fill(prompt);
  const sendButton = page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeEnabled({ timeout: 5_000 });
  await sendButton.click();
}

async function waitForUserMessageInTaskLogs(
  page: import("@playwright/test").Page,
  taskId: string,
  expectedText: string,
  timeoutMs = 12_000,
) {
  await expect
    .poll(
      async () => {
        const logs = await readTaskLogsSafe(page, taskId);
        return logs.some((entry) => {
          const data = entry.data as { type?: string; text?: string };
          return data?.type === "user_message" && data?.text === expectedText;
        });
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
}

async function setActiveSessionInStoreById(
  page: import("@playwright/test").Page,
  sessionId: string,
) {
  await page.evaluate((id) => {
    const store = (window as BrowserTestWindow).__test?.getStore?.();
    const activeWorkspaceId = store?.activeWorkspaceId;
    if (!activeWorkspaceId) return;
    const sessions = store?.sessionsByWorkspaceId?.[activeWorkspaceId] ?? [];
    if (!sessions.some((session) => session.id === id)) {
      throw new Error(`session ${id} not found in active workspace`);
    }
    store?.setActiveSession?.(id);
  }, sessionId);
}

async function createTaskViaComposer(page: import("@playwright/test").Page, prompt: string) {
  await page.getByTestId("chat-composer-input").fill(prompt);
  const sendButton = page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeEnabled({ timeout: 5_000 });
  await sendButton.click();
}

test.beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ide-ux-agentik-task-flow-"));
  fakeBinDir = mkdtempSync(join(tmpdir(), "ide-ux-agentik-fake-bin-"));
  mkdirSync(join(tmpRoot, "src"), { recursive: true });
  writeFileSync(join(tmpRoot, "README.md"), "# e2e-task-flow\n");
  writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "e2e-task-flow" }, null, 2));

  // The fake toolchain only has to emit valid JSON lines for the codex/claude paths
  // and emit the rollout warning on stderr when `RUST_LOG` was not normalized.
  writeFileSync(
    join(fakeBinDir, "codex"),
    buildFakeCliScript("11111111-1111-1111-1111-111111111111", true, {
      failResumeForPrompt: "queued codex stale resume follow-up",
      staleResumeMessage: "thread {sessionId} not found",
    }),
  );
  writeFileSync(
    join(fakeBinDir, "claude"),
    buildFakeCliScript("22222222-2222-2222-2222-222222222222", false, {
      failResumeForPrompt: "stale resume follow-up",
    }),
  );
  chmodSync(join(fakeBinDir, "codex"), 0o755);
  chmodSync(join(fakeBinDir, "claude"), 0o755);
  execSync("git init -q", { cwd: tmpRoot });
  execSync("git -c user.name=e2e -c user.email=e2e@example.com checkout -b main", {
    cwd: tmpRoot,
  });
  execSync("git add README.md package.json", { cwd: tmpRoot });
  execSync("git -c user.name=e2e -c user.email=e2e@example.com commit -m init", { cwd: tmpRoot });

  agentProcess = spawn(
    "node",
    [
      "--experimental-strip-types",
      "--no-warnings",
      "agent/server.ts",
      "--root",
      tmpRoot,
      "--port",
      String(AGENT_PORT),
      "--token",
      AGENT_TOKEN,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TASK_RUN_MS: "5000",
        PATH: `${fakeBinDir}:${process.env.PATH}`,
      },
    },
  );
  agentProcess.stderr?.on("data", () => {});
  agentProcess.stdout?.on("data", () => {});
  await waitForAgent();

  client = new AgentRpcClient(AGENT_BASE_URL, AGENT_TOKEN);
  await client.call("auth", { token: AGENT_TOKEN });
});

test.beforeEach(async ({ page }) => {
  await setTestEndpointInBrowser(page);
  page.on("pageerror", (error) => {
    console.log("[pageerror]", error.message);
  });
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") {
      console.log("[console.error]", text);
      return;
    }
    if (
      text.includes("[store.createTaskFromPrompt]") ||
      text.includes("[store.continueTaskFromPrompt]") ||
      text.includes("[store.tasks]") ||
      text.includes("[agent createTaskFromPrompt]") ||
      text.includes("[task.") ||
      text.includes("task.list") ||
      text.includes("task.create") ||
      text.includes("task.start")
    ) {
      console.log(`[console.${message.type()}]`, text);
    }
  });
  page.on("requestfinished", (request) => {
    if (!request.url().includes("/jsonrpc")) return;
    console.log("[requestfinished]", request.method(), request.url());
  });
});

test.afterAll(() => {
  try {
    client?.close();
  } catch {
    /* ignore */
  }
  client = null;
  try {
    agentProcess?.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  if (fakeBinDir) {
    try {
      rmSync(fakeBinDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  if (tmpRoot) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test.describe("Task continuation — codex + claude regression", () => {
  for (const scenario of CLI_OPTIONS) {
    test(`create then continue for ${scenario.cli} does not emit rollout warning`, async ({
      page,
    }) => {
      const { orgId, workspaceId } = await createTestOrgAndWorkspace();
      const { taskId } = await createAndFinishFirstPrompt(page, scenario, orgId, workspaceId);
      await sendFollowUpAndAwaitDone(page, workspaceId, taskId, `follow-up for ${scenario.cli}`);

      const logs = await readTaskLogsSafe(page, taskId);
      const hasRolloutWarning = logs.some((entry) =>
        dataToText(entry?.data).includes(WARNING_MARKER),
      );
      expect(hasRolloutWarning).toBe(false);
    });

    test(`deep-link task query and plan mode for ${scenario.cli} does not emit rollout warning`, async ({
      page,
    }) => {
      const { orgId, workspaceId } = await createTestOrgAndWorkspace();
      const { taskId } = await createAndFinishFirstPrompt(page, scenario, orgId, workspaceId);
      await page.goto(`/org/${orgId}?workspace=${workspaceId}&task=${taskId}`);
      await setActiveWorkspaceInStore(page, workspaceId);
      await expect.poll(() => getActiveTaskId(page), { timeout: 20_000 }).toBe(taskId);
      await ensureComposerAgent(page, workspaceId, scenario.cli, scenario.welcomeButtonName);
      await expect(page.getByRole("button", { name: "Toggle Plan Mode" })).toBeVisible();
      await page.getByRole("button", { name: "Toggle Plan Mode" }).click();
      await expect(
        page.evaluate((cli) => {
          const raw = window.localStorage.getItem("plan-mode-by-cli") ?? "{}";
          const parsed = JSON.parse(raw) as Record<string, boolean>;
          return parsed[cli] === true;
        }, scenario.cli),
      ).resolves.toBe(true);

      await sendFollowUpAndAwaitDone(
        page,
        workspaceId,
        taskId,
        `deep-link follow-up for ${scenario.cli}`,
      );
      const logs = await readTaskLogsSafe(page, taskId);
      const hasRolloutWarning = logs.some((entry) =>
        dataToText(entry?.data).includes(WARNING_MARKER),
      );
      expect(hasRolloutWarning).toBe(false);
    });
  }

  test("claude continuation retries once when the stored resume session is stale", async ({
    page,
  }) => {
    const scenario = CLI_OPTIONS.find((entry) => entry.cli === "claude")!;
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    const { taskId } = await createAndFinishFirstPrompt(page, scenario, orgId, workspaceId);

    await sendFollowUpAndAwaitDone(page, workspaceId, taskId, "stale resume follow-up");

    const logs = await readTaskLogsSafe(page, taskId);
    const hasRetryDiagnostic = logs.some((entry) => {
      const data = entry.data as { code?: string };
      return data?.code === "cli_resume_missing_retry";
    });
    const leakedRecoverableStderr = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return (
        data?.type === "stderr" &&
        typeof data.text === "string" &&
        data.text.includes("No conversation found with session ID")
      );
    });
    const hasRetriedAssistantReply = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return (
        data?.type === "assistant_message" &&
        typeof data.text === "string" &&
        data.text.includes("stale resume follow-up")
      );
    });

    expect(hasRetryDiagnostic).toBe(true);
    expect(leakedRecoverableStderr).toBe(false);
    expect(hasRetriedAssistantReply).toBe(true);
  });

  test("closing cli sessions deletes them from persistence and keeps task logs on reopen", async ({
    page,
  }) => {
    const scenario = CLI_OPTIONS[0];
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    const { taskId } = await createAndFinishFirstPrompt(page, scenario, orgId, workspaceId);

    const initialSessions = await listWorkspaceSessions(page, workspaceId);
    expect(initialSessions.length).toBeGreaterThanOrEqual(1);
    const baseTaskSessionId = initialSessions.find((session) => session.taskRootId === taskId)?.id;
    if (!baseTaskSessionId) {
      throw new Error(`missing initial task session for task ${taskId}`);
    }

    await openNewCliFromHeader(page, scenario.label);
    await expect
      .poll(() => listWorkspaceSessions(page, workspaceId), { timeout: 10_000 })
      .toHaveLength(2);

    const openSessions = await listWorkspaceSessions(page, workspaceId);
    const tempSession = openSessions.find(
      (session) => session.id !== baseTaskSessionId && !session.taskRootId && !session.taskId,
    );
    if (!tempSession) {
      throw new Error("missing temporary CLI session");
    }

    await closeSessionTabInPage(page, tempSession.id);
    await expect
      .poll(() => listWorkspaceSessions(page, workspaceId), { timeout: 10_000 })
      .toHaveLength(1);
    await expect.poll(() => getActiveTaskId(page), { timeout: 10_000 }).toBe(taskId);
    await expect
      .poll(async () => readTurnCompletedFromStore(page, taskId), { timeout: 10_000 })
      .toBe(true);

    await closeSessionTabInPage(page, baseTaskSessionId);
    await expect
      .poll(async () => (await listWorkspaceSessions(page, workspaceId)).length, {
        timeout: 10_000,
      })
      .toBe(0);

    await expect
      .poll(() => readAgentSessionsFromRpc(workspaceId).then((sessions) => sessions.length), {
        timeout: 15_000,
      })
      .toBe(0);

    await page.reload();
    await waitForActiveWorkspaceInStore(page, workspaceId);

    await expect
      .poll(() => listWorkspaceSessions(page, workspaceId).then((sessions) => sessions.length), {
        timeout: 15_000,
      })
      .toBe(0);

    await ensureActiveTaskInStore(page, taskId);
    await expect
      .poll(async () => readTurnCompletedFromStore(page, taskId), { timeout: 10_000 })
      .toBe(true);
  });

  test("multiple tasks queue and drain when max in-flight is reached", async ({ page }) => {
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
    await setActiveWorkspaceInStore(page, workspaceId);
    await ensureComposerAgent(page, workspaceId, "codex", "Codex");

    const created = await createTasksViaStore(page, workspaceId, [
      { cli: "codex", prompt: "queue task A" },
      { cli: "claude", prompt: "queue task B" },
      { cli: "codex", prompt: "queue task C" },
      { cli: "claude", prompt: "queue task D" },
    ]);
    expect(created).toHaveLength(4);

    expect(created.some((task) => task.status === "queued")).toBe(true);

    await expect
      .poll(
        async () => {
          const rows = await client!.call<Array<{ id: string; status: string }>>("task.list", {
            workspaceId,
          });
          const statuses = rows
            .filter((row) => created.some((item) => item.id === row.id))
            .map((row) => row.status);
          if (statuses.length !== created.length) return false;
          return statuses.every((status) => status === "done");
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  });

  test("continuation while running is queued then replayed", async ({ page }) => {
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
    await setActiveWorkspaceInStore(page, workspaceId);
    await ensureComposerAgent(page, workspaceId, "codex", "Codex");

    const created = await createTasksViaStore(page, workspaceId, [
      {
        cli: "codex",
        prompt: "seed follow-up test",
      },
    ]);
    const taskId = created[0]?.id;
    expect(taskId).toBeDefined();

    await waitForTaskStatus(page, workspaceId, taskId, "running");
    const continueResult = await client!.call<{ status?: string }>("task.continue", {
      taskId,
      prompt: "queued follow-up",
    });
    expect(continueResult?.status).toBe("queued");

    await waitForTaskStatus(page, workspaceId, taskId, "done", 30_000);
    const logs = await readTaskLogsSafe(page, taskId);
    const hasQueuedUserMessage = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return data?.type === "user_message" && data?.text === "queued follow-up";
    });
    const hasQueuedAssistantReply = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return data?.type === "assistant_message" && String(data?.text).includes("queued follow-up");
    });
    expect(hasQueuedUserMessage).toBe(true);
    expect(hasQueuedAssistantReply).toBe(true);
  });

  test("claude -p receives image attachments as local files", async () => {
    const { workspaceId } = await createTestOrgAndWorkspace();
    const attachmentBytes = "fake image bytes for claude";
    const created = await client!.call<{ id: string; sessionId: string }>("task.create", {
      workspaceId,
      title: "describe attached image",
      prompt: "Describe the attached image",
      cli: "claude",
      attachments: [
        {
          name: "kevin-lk.png",
          contentType: "image/png",
          kind: "image",
          data: Buffer.from(attachmentBytes).toString("base64"),
        },
      ],
    });

    await client!.call("task.start", { id: created.id });
    await expect
      .poll(
        async () => {
          const rows = await client!.call<Array<{ id: string; status: string }>>("task.list", {
            workspaceId,
          });
          return rows.find((row) => row.id === created.id)?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("done");

    const logs = await readTaskLogs(created.id);
    const transcript = logs.map((entry) => dataToText(entry.data)).join("\n");
    const attachmentPath = transcript.match(/\/[^\s"]+\.multica\/attachments\/[^\s"]+/)?.[0];
    expect(attachmentPath).toContain(join(".multica", "attachments", created.id));
    expect(readFileSync(attachmentPath!, "utf8")).toBe(attachmentBytes);

    expect(transcript).toContain("## Attachments");
    expect(transcript).toContain(attachmentPath);
  });

  test("composer image attachment is forwarded into an existing claude thread", async ({
    page,
  }) => {
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
    await setActiveWorkspaceInStore(page, workspaceId);
    await ensureComposerAgent(page, workspaceId, "claude", "Claude");

    const created = await createTasksViaStore(page, workspaceId, [
      {
        cli: "claude",
        prompt: "seed image follow-up thread",
      },
    ]);
    const taskId = created[0]?.id;
    expect(taskId).toBeDefined();
    await waitForTaskStatus(page, workspaceId, taskId, "done", 30_000);
    await ensureActiveTaskInStore(page, taskId);

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("Attach file or image").click();
    const chooser = await chooserPromise;
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    await chooser.setFiles([
      {
        name: "kevin-lk.png",
        mimeType: "image/png",
        buffer: imageBytes,
      },
    ]);

    await expect(page.getByLabel("Image attachment")).toBeVisible();
    await page.getByTestId("chat-composer-input").fill("homme ou femme sur la photo ?");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect
      .poll(
        async () => {
          const logs = await readTaskLogs(taskId);
          const transcript = logs.map((entry) => dataToText(entry.data)).join("\n");
          return transcript.includes(".multica/attachments") && transcript.includes("kevin-lk.png");
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    const logs = await readTaskLogs(taskId);
    const transcript = logs.map((entry) => dataToText(entry.data)).join("\n");
    const attachmentPath = transcript.match(
      /\/[^\s"]+\.multica\/attachments\/[^\s"]+kevin-lk\.png/,
    )?.[0];

    expect(attachmentPath).toContain(join(".multica", "attachments", taskId));
    expect(readFileSync(attachmentPath!)).toEqual(imageBytes);

    expect(transcript).toContain("## Attachments");
    expect(transcript).toContain(attachmentPath);
  });

  test("queued claude -p continuation retries stale resume without leaking stderr", async ({
    page,
  }) => {
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
    await setActiveWorkspaceInStore(page, workspaceId);
    await ensureComposerAgent(page, workspaceId, "claude", "Claude");

    const created = await createTasksViaStore(page, workspaceId, [
      {
        cli: "claude",
        prompt: "seed queued stale resume test",
      },
    ]);
    const taskId = created[0]?.id;
    expect(taskId).toBeDefined();

    await waitForTaskStatus(page, workspaceId, taskId, "running");
    const continueResult = await client!.call<{ status?: string }>("task.continue", {
      taskId,
      prompt: "queued stale resume follow-up",
    });
    expect(continueResult?.status).toBe("queued");

    await waitForTaskStatus(page, workspaceId, taskId, "done", 30_000);
    const logs = await readTaskLogsSafe(page, taskId);
    const hasRetryDiagnostic = logs.some((entry) => {
      const data = entry.data as { code?: string };
      return data?.code === "cli_resume_missing_retry";
    });
    const leakedRecoverableStderr = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return (
        data?.type === "stderr" &&
        typeof data.text === "string" &&
        data.text.includes("No conversation found with session ID")
      );
    });
    const hasQueuedAssistantReply = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return (
        data?.type === "assistant_message" &&
        String(data?.text).includes("queued stale resume follow-up")
      );
    });

    expect(hasRetryDiagnostic).toBe(true);
    expect(leakedRecoverableStderr).toBe(false);
    expect(hasQueuedAssistantReply).toBe(true);
  });

  test("queued codex continuation uses the generic stale resume retry strategy", async ({
    page,
  }) => {
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
    await setActiveWorkspaceInStore(page, workspaceId);
    await ensureComposerAgent(page, workspaceId, "codex", "Codex");

    const created = await createTasksViaStore(page, workspaceId, [
      {
        cli: "codex",
        prompt: "seed queued codex stale resume test",
      },
    ]);
    const taskId = created[0]?.id;
    expect(taskId).toBeDefined();

    await waitForTaskStatus(page, workspaceId, taskId, "running");
    const continueResult = await client!.call<{ status?: string }>("task.continue", {
      taskId,
      prompt: "queued codex stale resume follow-up",
    });
    expect(continueResult?.status).toBe("queued");

    await waitForTaskStatus(page, workspaceId, taskId, "done", 30_000);
    const logs = await readTaskLogsSafe(page, taskId);
    const hasRetryDiagnostic = logs.some((entry) => {
      const data = entry.data as { code?: string };
      return data?.code === "cli_resume_missing_retry";
    });
    const leakedRecoverableStderr = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return (
        data?.type === "stderr" &&
        typeof data.text === "string" &&
        data.text.includes("thread") &&
        data.text.includes("not found")
      );
    });
    const hasQueuedAssistantReply = logs.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return (
        data?.type === "assistant_message" &&
        String(data?.text).includes("queued codex stale resume follow-up")
      );
    });

    expect(hasRetryDiagnostic).toBe(true);
    expect(leakedRecoverableStderr).toBe(false);
    expect(hasQueuedAssistantReply).toBe(true);
  });

  test("UI can queue follow-up on running task with mixed CLIs", async ({ page }) => {
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
    await setActiveWorkspaceInStore(page, workspaceId);

    const created = await createTasksViaStore(page, workspaceId, [
      { cli: "codex", prompt: "ui mixed cli task A" },
      { cli: "claude", prompt: "ui mixed cli task B" },
    ]);
    expect(created).toHaveLength(2);

    const taskA = created[0];
    const taskB = created[1];
    expect(taskA?.id).toBeTruthy();
    expect(taskB?.id).toBeTruthy();

    await waitForTaskStatus(page, workspaceId, taskA.id, "running");
    await waitForTaskStatus(page, workspaceId, taskB.id, "running");

    await ensureActiveTaskInStore(page, taskA.id);
    await page.getByRole("button", { name: "Send message" }).waitFor({ timeout: 10_000 });
    await sendFollowUpFromComposer(page, "queued follow-up on task A");
    await waitForTaskStatus(page, workspaceId, taskA.id, "queued");

    await ensureActiveTaskInStore(page, taskB.id);
    await sendFollowUpFromComposer(page, "queued follow-up on task B");
    await waitForTaskStatus(page, workspaceId, taskB.id, "queued");

    await waitForTaskStatus(page, workspaceId, taskA.id, "done", 30_000);
    await waitForTaskStatus(page, workspaceId, taskB.id, "done", 30_000);

    const logsA = await readTaskLogsSafe(page, taskA.id);
    const logsB = await readTaskLogsSafe(page, taskB.id);
    const followA = logsA.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return data?.type === "user_message" && data?.text === "queued follow-up on task A";
    });
    const followB = logsB.some((entry) => {
      const data = entry.data as { type?: string; text?: string };
      return data?.type === "user_message" && data?.text === "queued follow-up on task B";
    });
    expect(followA).toBe(true);
    expect(followB).toBe(true);
  });

  test("UI composer can run mixed CLIs in parallel and queue follow-ups after tab switch", async ({
    page,
  }) => {
    const { orgId, workspaceId } = await createTestOrgAndWorkspace();
    await page.goto(`/org/${orgId}?workspace=${workspaceId}`);
    await setActiveWorkspaceInStore(page, workspaceId);

    await ensureComposerAgent(page, workspaceId, "codex", "Codex");
    await createTaskViaComposer(page, "parallel codex first task");
    const codexTask = await waitForActiveTask(page);
    await waitForTaskStatus(page, workspaceId, codexTask, "running");

    await openNewCliFromHeader(page, "Claude");
    const sessions = await listWorkspaceSessions(page, workspaceId);
    const claudeSessionId = sessions.find((session) => session.id.includes("claude"))?.id;
    if (!claudeSessionId) {
      throw new Error("Claude session tab was not created");
    }
    await setActiveSessionInStoreById(page, claudeSessionId);
    await page.waitForTimeout(200);
    await createTaskViaComposer(page, "parallel claude second task");
    const claudeTask = await waitForActiveTask(page);
    await waitForTaskStatus(page, workspaceId, claudeTask, "running");

    const sessionsAfterCreate = await listWorkspaceSessions(page, workspaceId);
    const codexSessionId = sessionsAfterCreate.find(
      (session) => session.id !== claudeSessionId && session.taskRootId === codexTask,
    )?.id;
    if (!codexSessionId) {
      throw new Error("Codex task session not found");
    }

    const claudeTaskSessionId = sessionsAfterCreate.find(
      (session) => session.taskRootId === claudeTask || session.taskId === claudeTask,
    )?.id;
    if (!claudeTaskSessionId) {
      throw new Error("Claude task session not found");
    }

    await setActiveSessionInStoreById(page, codexSessionId);
    await sendFollowUpFromComposer(page, "first queue point on codex");
    await waitForUserMessageInTaskLogs(page, codexTask, "first queue point on codex");

    await setActiveSessionInStoreById(page, claudeTaskSessionId);
    await sendFollowUpFromComposer(page, "first queue point on claude");
    await waitForUserMessageInTaskLogs(page, claudeTask, "first queue point on claude");

    await waitForTaskStatus(page, workspaceId, codexTask, "done", 30_000);
    await waitForTaskStatus(page, workspaceId, claudeTask, "done", 30_000);

    const codexLogs = await readTaskLogsSafe(page, codexTask);
    const claudeLogs = await readTaskLogsSafe(page, claudeTask);
    expect(
      codexLogs.some(
        (entry) =>
          entry.data &&
          "type" in (entry.data as Record<string, unknown>) &&
          (entry.data as Record<string, unknown>).type === "user_message",
      ),
    ).toBe(true);
    expect(
      claudeLogs.some(
        (entry) =>
          entry.data &&
          "type" in (entry.data as Record<string, unknown>) &&
          (entry.data as Record<string, unknown>).type === "user_message",
      ),
    ).toBe(true);
  });
});
