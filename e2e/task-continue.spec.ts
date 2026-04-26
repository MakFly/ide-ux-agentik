import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
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
      this.pending.set(id, { resolve, reject });
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

function buildFakeCliScript(runtimeMarker: string, emitWarning: boolean): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const rustLog = process.env.RUST_LOG || "";
if (${emitWarning ? "true" : "false"}) {
  if (${runtimeMarker ? `"${runtimeMarker}"` : '""'} && !String(rustLog).includes("codex_core::session=off")) {
  console.error("${WARNING_MARKER}: " + String(${runtimeMarker || "000"}));
  }
}
const prompt = String(fs.readFileSync(0, "utf8")).trim();
const emit = (obj) => {
  process.stdout.write(String(JSON.stringify(obj)) + "\\n");
};
emit({ type: "thread.started" });
emit({ type: "turn.started" });
emit({ type: "assistant_message", text: "Mock response for " + (prompt || "task") });
emit({ type: "turn.completed" });
`;
}

let agentProcess: ChildProcessWithoutNullStreams | null = null;
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
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
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
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
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
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
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

async function readTaskLogs(taskId: string) {
  if (!client) throw new Error("rpc client is not initialized");
  return client.call<Array<{ data: unknown }>>("task.logs.list", { taskId });
}

async function readTaskLogsSafe(page: import("@playwright/test").Page, taskId: string) {
  const rpcLogs = await readTaskLogs(taskId).catch(() => []);
  const storeLogs = await readTaskLogsFromStore(page, taskId).catch(() => []);
  return [...rpcLogs, ...storeLogs];
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
      (window as unknown as { __AGENT__?: { url: string; token: string } }).__AGENT__ = {
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
          const store = (
            window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
          ).__test?.getStore?.();
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
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
    if (!store) return;
    if (store.activeWorkspaceId !== id) {
      store.setActiveWorkspace(id);
    }
  }, workspaceId);

  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const store = (
            window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
          ).__test?.getStore?.();
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
      const store = (
        window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
      ).__test?.getStore?.();
      return store?.composerAgentByWorkspaceId?.[id] === cliId;
    },
    { id: workspaceId, cliId: cli },
  );
  if (!selected) {
    await page.evaluate(
      ({ id, cliId }) => {
        const store = (
          window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
        ).__test?.getStore?.();
        if (!store) return;
        store.setComposerAgent(id, cliId);
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
          const store = (
            window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
          ).__test?.getStore?.();
          return (
            !!store?.tasksByWorkspaceId &&
            Object.values(store.tasksByWorkspaceId).some((tasks: unknown[]) =>
              (tasks ?? []).some((task: { id: string }) => task.id === id),
            )
          );
        }, taskId),
      { timeout: 10_000 },
    )
    .toBeTruthy();

  await page.evaluate((id) => {
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
    store?.setActiveTask(id);
  }, taskId);

  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const store = (
            window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
          ).__test?.getStore?.();
          return store?.activeTaskId === id;
        }, taskId),
      { timeout: 10_000 },
    )
    .toBeTruthy();
}

async function getActiveTaskId(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore();
    return store?.activeTaskId ?? null;
  });
}

type StoreSession = {
  id: string;
  kind: string;
  taskRootId?: string;
  taskId?: string;
};

async function listWorkspaceSessions(
  page: import("@playwright/test").Page,
  workspaceId: string,
): Promise<StoreSession[]> {
  return page.evaluate((id) => {
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
    const sessions = (store?.sessionsByWorkspaceId?.[id] ?? []) as StoreSession[] | undefined;
    return sessions ?? [];
  }, workspaceId);
}

async function closeSessionTabInPage(page: import("@playwright/test").Page, sessionId: string) {
  await page.evaluate((sid) => {
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
    if (!store) return;
    store.closeSessionTab(sid);
  }, sessionId);
}

async function openNewCliFromHeader(
  page: import("@playwright/test").Page,
  cliName: string,
) {
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
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
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
        Object.entries(store?.tasksByWorkspaceId ?? {}).map(([id, tasks]: [string, unknown[]]) => [
          id,
          (tasks ?? []).length,
        ]),
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
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
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
    const store = (
      window as unknown as { __test?: { getStore?: () => Record<string, unknown> } }
    ).__test?.getStore?.();
    return {
      activeWorkspaceId: store?.activeWorkspaceId,
      activeTaskId: store?.activeTaskId,
      taskCountByWorkspace: Object.fromEntries(
        Object.entries(store?.tasksByWorkspaceId ?? {}).map(
          ([workspaceId, tasks]: [string, unknown[]]) => [workspaceId, tasks?.length ?? 0],
        ),
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
  await expect(page.getByTestId("chat-composer-stop")).not.toBeVisible({ timeout: 2_000 });
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
    buildFakeCliScript("11111111-1111-1111-1111-111111111111", true),
  );
  writeFileSync(
    join(fakeBinDir, "claude"),
    buildFakeCliScript("22222222-2222-2222-2222-222222222222", false),
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
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
    },
  );
  agentProcess.stderr.on("data", () => {});
  agentProcess.stdout.on("data", () => {});
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
      await ensureActiveTaskInStore(page, taskId);
      await ensureComposerAgent(page, workspaceId, scenario.cli, scenario.welcomeButtonName);

      await expect.poll(async () => getActiveTaskId(page)).toBe(taskId, { timeout: 10_000 });
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

  test("closing cli sessions deletes them from persistence and keeps task logs on reopen", async ({ page }) => {
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
});
