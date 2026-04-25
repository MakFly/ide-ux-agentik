import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Integration tests with a real Node agent.
 *
 * Enabled only when PLAYWRIGHT_WITH_AGENT=1. Spawns `node agent/server.ts`
 * (Node 24 reads TS natively via --experimental-strip-types) against a temp
 * project root, wires it into the app via `window.__ideStore` (exposed in
 * dev builds only), then runs provider checks.
 */

const AGENT_PORT = 7591;
const AGENT_TOKEN = "e2e-test-token";

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
  tmpRoot = mkdtempSync(join(tmpdir(), "ide-ux-agentik-e2e-"));
  mkdirSync(join(tmpRoot, "src"), { recursive: true });
  writeFileSync(join(tmpRoot, "README.md"), "# E2E test project\n");
  writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ name: "e2e-fake" }, null, 2));
  writeFileSync(join(tmpRoot, "src", "main.ts"), "console.log('hello');\n");

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

async function seedRemoteAgentWorkspace(page: import("@playwright/test").Page) {
  // Hard navigations wipe the zustand store, so the seed must run on whichever
  // page the test is currently on. Wait for hydration (__ideStore is installed
  // inside a useEffect), then idempotently add + activate the workspace.
  await page
    .waitForFunction(() => !!(window as unknown as { __ideStore?: unknown }).__ideStore, null, {
      timeout: 10_000,
    })
    .catch(() => {});
  const ok = await page.evaluate(
    ({ url, token }) => {
      // The dev build exposes a minimal testing handle so we can seed a
      // remote-agent workspace without driving the add-workspace dialog.
      type Api = {
        addWorkspace: (name: string, source: unknown) => void;
        setActiveWorkspace: (id: string) => void;
        workspaces: Array<{ id: string; name: string }>;
      };
      const api = (window as unknown as { __ideStore?: Api }).__ideStore;
      if (!api) return false;
      api.addWorkspace("e2e-agent", { kind: "remote-agent", url, token, label: "e2e" });
      const ws = api.workspaces.find((w) => w.name === "e2e-agent");
      if (ws) api.setActiveWorkspace(ws.id);
      return true;
    },
    { url: `ws://localhost:${AGENT_PORT}`, token: AGENT_TOKEN },
  );
  return ok;
}

test.describe("integration — real bun agent", () => {
  test("agent check reaches the remote host", async ({ page }) => {
    await page.goto("/settings?section=providers");
    const seeded = await seedRemoteAgentWorkspace(page);
    test.skip(!seeded, "dev-only __ideStore handle not exposed");
    await page.getByTestId("check-codex").click();
    await expect(page.getByTestId("check-codex-summary")).toBeVisible({ timeout: 20_000 });
    const summary = (await page.getByTestId("check-codex-summary").textContent()) ?? "";
    // The agent is reachable: we should NOT see a transport-level failure.
    expect(summary).not.toMatch(/connection failed|not a remote-agent/i);
  });

  test("claude check surfaces whether binary is installed", async ({ page }) => {
    await page.goto("/settings?section=providers");
    const seeded = await seedRemoteAgentWorkspace(page);
    test.skip(!seeded, "dev-only __ideStore handle not exposed");
    await page.getByTestId("check-claude").click();
    const summary = page.getByTestId("check-claude-summary");
    await expect(summary).toBeVisible({ timeout: 20_000 });
    // Poll until the running placeholder flips to the final verdict — a cold
    // `claude` binary (first-run telemetry) can take 10+s on some machines.
    await expect(summary).toHaveText(/Ready|Missing/, { timeout: 40_000 });
  });
});
