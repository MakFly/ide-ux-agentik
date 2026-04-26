import { defineConfig, devices } from "@playwright/test";

/**
 * Real E2E tests.
 *
 * By default, runs only the offline suite (/settings UI with no agent).
 * To run the integration suite (requires `codex` on PATH and a Node agent):
 *   PLAYWRIGHT_WITH_AGENT=1 bun run test:e2e
 *
 * The offline webServer starts Vite alone (`dev:web`) so auto-registered
 * dev-agent workspaces don't interfere with offline assertions. The
 * integration suite spawns its own agent from within the test.
 */

const WITH_AGENT = process.env.PLAYWRIGHT_WITH_AGENT === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // port contention — keep serial
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8099",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: WITH_AGENT ? /.*\.spec\.ts/ : /(smoke|task-workflow|workflow-task-tree)\.spec\.ts/,
    },
  ],
  webServer: {
    // Offline suite: Vite only, no auto-agent. Integration suite: same Vite,
    // agent is spawned ad-hoc by the spec onto a distinct port (7591).
    command: "bunx vite dev --port 8099 --strictPort",
    url: "http://127.0.0.1:8099",
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
