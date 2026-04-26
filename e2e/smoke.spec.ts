import { expect, test } from "@playwright/test";

/**
 * Offline smoke tests — exercise the /settings UI without a running agent.
 * All provider Check buttons should report a connection failure (not crash).
 */

test.beforeEach(async ({ context }) => {
  // Reset any persisted codex tokens / api keys from previous runs so the
  // "Sign in with ChatGPT" CTA is always visible.
  await context.addInitScript(() => {
    try {
      window.localStorage.removeItem("codex-auth");
      window.localStorage.removeItem("codex-api-key");
      window.localStorage.removeItem("agentik.global-agent.endpoint.v1");
    } catch {
      /* ignore */
    }
  });
});

async function ensureMockWorkspaceActive(page: import("@playwright/test").Page) {
  // If the dev server also spawned a local agent (bun run dev instead of
  // dev:web), a `local-dev` remote-agent workspace may have been auto-added.
  // Switch back to the built-in mock workspace so the offline assertions hold.
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __ideStore?: { workspaces: Array<{ id: string; name: string }> } })
        .__ideStore,
    null,
    { timeout: 5_000 },
  );
  await page.evaluate(() => {
    type Api = {
      setActiveWorkspace: (id: string) => void;
      workspaces: Array<{ id: string; name: string; source?: { kind: string } }>;
    };
    const api = (window as unknown as { __ideStore?: Api }).__ideStore;
    if (!api) return;
    const mock = api.workspaces.find((w) => w.source?.kind === "mock");
    if (mock) api.setActiveWorkspace(mock.id);
  });
}

test.describe("settings page — offline", () => {
  test("renders provider cards and runs check that fails cleanly", async ({ page }) => {
    await page.goto("/settings?section=providers");
    await ensureMockWorkspaceActive(page);
    await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();

    for (const provider of ["codex", "claude", "opencode", "gemini"] as const) {
      await expect(page.locator(`[data-provider="${provider}"]`)).toBeVisible();
    }

    const btn = page.getByTestId("check-codex");
    await btn.scrollIntoViewIfNeeded();
    await btn.click();

    const summary = page.getByTestId("check-codex-summary");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    // Poll until the "Running…" placeholder flips to the final message.
    await expect(summary).not.toHaveText(/Running/i, { timeout: 15_000 });
    const text = (await summary.textContent()) ?? "";
    expect(text).toMatch(/remote-agent|connection|checks require/i);
  });

  test("codex sign-in dialog opens via ?login=codex", async ({ page }) => {
    await page.goto("/settings?login=codex");
    await expect(page.getByRole("heading", { name: "Sign in to Codex" })).toBeVisible();
    await expect(page.getByText(/ChatGPT device authorization flow/i)).toBeVisible();
  });

  test("codex sign-in dialog opens via button", async ({ page }) => {
    await page.goto("/settings?section=providers&provider=codex");
    // Wait for hydration — React 19 + TanStack Start SSR means DOM is present
    // before onClick handlers are attached. Polling an attribute that is only
    // rendered by the client component ensures hydration is complete.
    await expect(page.locator("[data-login-open]")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const btn = page.getByTestId("codex-signin");
    await expect(btn).toBeVisible();
    const container = page.locator("[data-login-open]");
    await expect(container).toHaveAttribute("data-login-open", "false");
    await btn.click();
    await expect(container).toHaveAttribute("data-login-open", "true", { timeout: 5_000 });
    await expect(page.getByText("Sign in to Codex")).toBeVisible({ timeout: 5_000 });
  });

  test("runtime local-dev endpoint beats a stale saved local-dev override", async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem(
        "agentik.global-agent.endpoint.v1",
        JSON.stringify({
          url: "ws://127.0.0.1:7421",
          token: "stale-token",
          label: "local-dev",
        }),
      );
      (window as unknown as { __AGENT__?: { url: string; token: string; label: string } }).__AGENT__ =
        {
          url: "ws://127.0.0.1:7421",
          token: "fresh-token",
          label: "local-dev",
        };
    });

    await page.goto("/settings?section=agent");

    await expect(page.getByText("Connection source")).toBeVisible();
    await expect(page.getByText("Using window.__AGENT__ until you save an override.")).toBeVisible();
    await expect(page.locator("#global-agent-token")).toHaveValue("fresh-token");
  });
});
