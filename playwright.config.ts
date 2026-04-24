import { defineConfig, devices } from "@playwright/test";

/**
 * Real E2E tests.
 *
 * By default, runs only the offline suite (/settings UI with no agent).
 * To run the integration suite (requires `codex` on PATH and a Bun agent):
 *   PLAYWRIGHT_WITH_AGENT=1 bun run test:e2e
 *
 * The webServer directive starts `bun run dev` on port 3000 (matches the
 * Vite/TanStack Start default in this repo).
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
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: WITH_AGENT ? /.*\.spec\.ts/ : /smoke\.spec\.ts/,
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
