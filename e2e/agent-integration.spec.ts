import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Integration tests with a real Bun agent.
 *
 * Enabled only when PLAYWRIGHT_WITH_AGENT=1. Spawns `bun run agent/server.ts`
 * against a temp project root, wires it into the app via `window.__ideStore`
 * (exposed in dev builds only), then runs provider checks.
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
    "bun",
    [
      "run",
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
  await page.goto("/");
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
    const seeded = await seedRemoteAgentWorkspace(page);
    test.skip(!seeded, "dev-only __ideStore handle not exposed");

    await page.goto("/settings");
    await page.getByTestId("check-codex").click();
    await expect(page.getByTestId("check-codex-summary")).toBeVisible({ timeout: 20_000 });
    const summary = (await page.getByTestId("check-codex-summary").textContent()) ?? "";
    // The agent is reachable: we should NOT see a transport-level failure.
    expect(summary).not.toMatch(/connection failed|not a remote-agent/i);
  });

  test("claude check surfaces whether binary is installed", async ({ page }) => {
    const seeded = await seedRemoteAgentWorkspace(page);
    test.skip(!seeded, "dev-only __ideStore handle not exposed");
    await page.goto("/settings");
    await page.getByTestId("check-claude").click();
    await expect(page.getByTestId("check-claude-summary")).toBeVisible({ timeout: 20_000 });
    const summary = (await page.getByTestId("check-claude-summary").textContent()) ?? "";
    // We don't assume claude IS installed. Just that the check ran and
    // produced a deterministic message (Ready / Missing binary or auth).
    expect(summary).toMatch(/Ready|Missing/);
  });
});
