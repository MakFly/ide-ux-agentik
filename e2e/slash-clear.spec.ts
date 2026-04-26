import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * `/clear` integration spec — verifies that typing `/clear` in the composer
 * wipes the thread in-place (no hard refresh), and that the DB rows are
 * actually gone after the interaction.
 *
 * Runs only under PLAYWRIGHT_WITH_AGENT=1 because it requires a live Node
 * agent (RPC for persistence.messages.{append,deleteForSession,list}).
 */

const AGENT_PORT = 7592;
const AGENT_TOKEN = process.env.E2E_AGENT_TOKEN ?? randomUUID();

let agent: ChildProcessWithoutNullStreams | null = null;
let tmpRoot: string | null = null;

async function waitForAgent(port: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`agent did not come up on port ${port}`);
}

test.beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ide-ux-agentik-clear-"));
  mkdirSync(join(tmpRoot, "src"), { recursive: true });
  writeFileSync(join(tmpRoot, "README.md"), "# slash-clear e2e\n");
  writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "e2e-clear" }, null, 2));

  agent = spawn(
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
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  agent.stderr.on("data", () => {});
  agent.stdout.on("data", () => {});

  await waitForAgent(AGENT_PORT);
});

test.afterAll(() => {
  try {
    agent?.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  if (tmpRoot) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

type IdeStoreHandle = {
  addWorkspace: (name: string, source: unknown) => void;
  setActiveWorkspace: (id: string) => void;
  workspaces: Array<{ id: string; name: string }>;
  addAgentSession: (kind: "codex" | "claude" | "opencode" | "gemini") => string | undefined;
  getActiveSessionId: (workspaceId: string) => string | undefined;
  seedMessages: (sessionId: string, count: number) => Promise<void>;
  listMessages: (sessionId: string) => Promise<Array<{ id: string }>>;
};

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as { __ideStore?: unknown }).__ideStore,
    null,
    { timeout: 10_000 },
  );
}

async function seedWorkspace(page: Page): Promise<string | null> {
  await waitForStore(page);
  return page.evaluate(
    ({ url, token }) => {
      const api = (window as unknown as { __ideStore?: IdeStoreHandle }).__ideStore;
      if (!api) return null;
      api.addWorkspace("e2e-clear-ws", {
        kind: "remote-agent",
        url,
        token,
        label: "e2e-clear",
      });
      const ws = api.workspaces.find((w) => w.name === "e2e-clear-ws");
      if (!ws) return null;
      api.setActiveWorkspace(ws.id);
      return ws.id;
    },
    { url: `ws://localhost:${AGENT_PORT}`, token: AGENT_TOKEN },
  );
}

test.describe("/clear — wipes the thread without a hard refresh", () => {
  test("typing /clear empties the composer and removes DB rows in-place", async ({ page }) => {
    // Track any reload — the whole point is that /clear must NOT trigger one.
    let reloadCount = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) reloadCount++;
    });

    await page.goto("/");
    const workspaceId = await seedWorkspace(page);
    test.skip(!workspaceId, "dev-only __ideStore handle not exposed");

    // Create a codex session + inject 4 fake messages in the DB for it.
    const sessionId = await page.evaluate(() => {
      const api = (window as unknown as { __ideStore?: IdeStoreHandle }).__ideStore;
      if (!api) return null;
      return api.addAgentSession("codex") ?? null;
    });
    expect(sessionId).toBeTruthy();

    await page.evaluate(
      async ({ sid }) => {
        const api = (window as unknown as { __ideStore?: IdeStoreHandle }).__ideStore;
        if (!api || !sid) throw new Error("no handle / session");
        await api.seedMessages(sid, 4);
      },
      { sid: sessionId },
    );

    // The chat view should hydrate from DB and display the seeded messages.
    // Baseline: at least one user + one assistant bubble visible.
    const thread = page.getByTestId("chat-thread");
    await expect(thread).toBeVisible({ timeout: 10_000 });
    await expect(thread.locator('[data-role="user"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(thread.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 10_000,
    });
    const beforeCount = await thread.locator('[data-role="user"], [data-role="assistant"]').count();
    expect(beforeCount).toBeGreaterThanOrEqual(4);

    // Capture the frame-navigation counter *after* initial hydration so we
    // only count navigations that happen during /clear itself.
    const reloadsBefore = reloadCount;

    // Type /clear and submit.
    const input = page.getByTestId("chat-composer-input");
    await input.click();
    await input.fill("/clear");
    await input.press("Enter");

    // Thread should become empty in < 2s, no reload.
    await expect
      .poll(async () => thread.locator('[data-role="user"], [data-role="assistant"]').count(), {
        timeout: 2_000,
      })
      .toBe(0);

    // No full-page reload was triggered.
    expect(reloadCount).toBe(reloadsBefore);

    // DB confirms: the rows are gone for this session.
    const dbRows = await page.evaluate(
      async ({ sid }) => {
        const api = (window as unknown as { __ideStore?: IdeStoreHandle }).__ideStore;
        if (!api || !sid) return -1;
        const rows = await api.listMessages(sid);
        return rows.length;
      },
      { sid: sessionId },
    );
    expect(dbRows).toBe(0);
  });
});
