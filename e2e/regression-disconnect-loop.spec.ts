import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForTestAPI } from "./test-helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Regression: `RemoteAgentProvider.disconnect()` previously called
 * `this.ws?.close()` with no code, which made browsers emit a `close`
 * event with code 1005 ("no status received"). The provider's `close`
 * listener then mistook that for an abnormal closure and triggered an
 * unwanted reconnect cycle, surfacing as a stream of "Reconnected" toasts
 * and tearing down legitimate work in flight (the symptom that surfaced
 * to users: spawning a second CLI session for a task killed the first
 * one's stream because the shared WS reconnected mid-flight, dropping
 * `task.event` broadcasts).
 *
 * Fix:
 *   1. `disconnect()` now calls `ws.close(1000, "client disconnect")`
 *      explicitly so the `close` listener takes the normal-closure path.
 *   2. `_reconnect()` clears `pending` at start so callers that issued
 *      RPCs during a flap get a fast rejection instead of hanging 31s.
 *   3. `pty-terminal.tsx` uses `JSON.stringify(extraEnv)` in the
 *      `useEffect` deps and drops `banner` (cosmetic, not lifecycle) so
 *      a fresh banner array reference doesn't tear down a healthy PTY.
 *
 * Run: bunx playwright test e2e/regression-disconnect-loop.spec.ts
 */

const REMOTE_AGENT_SRC = resolve(__dirname, "..", "src/lib/fs/remote-agent.ts");
const PTY_TERMINAL_SRC = resolve(__dirname, "..", "src/components/ide/pty-terminal.tsx");

test.describe("regression — disconnect / reconnect loop (Bug 2)", () => {
  test("disconnect() calls ws.close with explicit code 1000", () => {
    const src = readFileSync(REMOTE_AGENT_SRC, "utf8");

    // Locate the disconnect method.
    const start = src.indexOf("async disconnect()");
    expect(start, "disconnect() method not found in remote-agent.ts").toBeGreaterThan(-1);
    const end = src.indexOf("}", src.indexOf("watchers.clear()", start));
    const body = src.slice(start, end);

    expect(body, "disconnect() must pass close code 1000 explicitly").toMatch(
      /this\.ws\?\.close\(\s*1000/,
    );
    // It must NOT contain the legacy bare `close()` call.
    expect(body, "disconnect() still has the legacy bare close() call").not.toMatch(
      /this\.ws\?\.close\(\s*\)/,
    );
  });

  test("_reconnect() clears pending RPCs at start of each cycle", () => {
    const src = readFileSync(REMOTE_AGENT_SRC, "utf8");
    const start = src.indexOf("private async _reconnect()");
    expect(start, "_reconnect() not found").toBeGreaterThan(-1);
    const end = src.indexOf("setTimeout(()", start);
    const head = src.slice(start, end);
    expect(head).toMatch(/_clearPending\(/);
  });

  test("pty-terminal useEffect deps stabilise extraEnv and drop banner", () => {
    const src = readFileSync(PTY_TERMINAL_SRC, "utf8");
    expect(src, "extraEnv must be JSON.stringify'd to keep dep array referentially stable").toMatch(
      /JSON\.stringify\(extraEnv\s*\?\?\s*\{\}\)/,
    );
    // Extract the deps array of the main PTY useEffect. The array opens with
    // `}, [` and closes with `]);`. Anchor on the unique marker
    // `JSON.stringify(extraEnv` (only present in this deps array), then walk
    // forward to `]);`. Strip `// …` comments so only real identifiers remain.
    const anchor = src.indexOf("JSON.stringify(extraEnv");
    expect(anchor, "deps anchor (JSON.stringify(extraEnv ...)) not found").toBeGreaterThan(-1);
    const close = src.indexOf("]);", anchor);
    expect(close, "useEffect deps closing bracket not found").toBeGreaterThan(-1);
    const depsBlock = src.slice(anchor, close);
    const depsNoComments = depsBlock.replace(/\/\/[^\n]*/g, "");
    expect(depsNoComments).not.toMatch(/\bbanner\b/);
  });

  test("loading the offline app surfaces no 'Reconnected' / 'Reconnecting' toast", async ({
    page,
  }) => {
    // Offline mode → no agent → no provider → no reconnect cycle expected.
    // If a regression slipped in (e.g. someone reintroduces close() without
    // a code), the spurious reconnect would surface as a toast in the DOM.
    await page.goto("/");
    await waitForTestAPI(page);
    await page.waitForTimeout(3500);

    const toastCount = await page
      .locator("[data-sonner-toast], [role='status'], [data-radix-toast-root]")
      .filter({ hasText: /reconnect/i })
      .count();
    expect(toastCount).toBe(0);
  });
});
