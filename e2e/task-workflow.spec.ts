import { expect, test } from "@playwright/test";
import { seedTaskInPage, pushTaskEventInPage, waitForTestAPI } from "./test-helpers";

/**
 * Task-centric workflow e2e suite (store-level tests).
 *
 * These tests verify the task store implementation and related helpers without
 * requiring the full workspace UI. They focus on:
 * - Store mutations (upsertTask, pushEvent, removeTask)
 * - Test API availability (__test helpers)
 * - Event structure validation
 *
 * NOTE: Full UI integration tests (sidebar rendering, tab switching, etc.)
 * require a complete app setup with org/workspace. Those are planned for
 * Wave 4 as part of the dashboard integration spec.
 *
 * Run: bunx playwright test e2e/task-workflow.spec.ts
 *      bunx playwright test e2e/task-workflow.spec.ts --ui
 */

test.beforeEach(async ({ page }) => {
  // Navigate to settings (doesn't require org/workspace).
  // The IDE store and __test helpers are still available.
  await page.goto("/settings?section=appearance");
});

test.describe("task workflow — store-level", () => {
  test("1. test API availability", async ({ page }) => {
    // Verify that __test helpers are available for seeding tasks.
    await waitForTestAPI(page);

    const apiExists = await page.evaluate(() => {
      const api = (window as any).__test;
      return !!(api && api.seedTask && api.pushTaskEvent && api.getStore);
    });

    expect(apiExists).toBe(true);
  });

  test("2. seedTask injects into store", async ({ page }) => {
    // Seed a task and verify it appears in the store.
    const task = await seedTaskInPage(page, {
      prompt: "test task",
      title: "Test Task",
      status: "queued",
      cli: "codex",
    });

    // Query the store to verify the task was added.
    const stored = await page.evaluate(
      ({ taskId }) => {
        const api = (window as any).__test;
        const store = api?.getStore();
        const allTasks: Record<string, unknown>[] = [];
        for (const tasks of Object.values(store?.tasksByWorkspaceId || {})) {
          allTasks.push(...(tasks || []));
        }
        return allTasks.find((t: any) => t.id === taskId);
      },
      { taskId: task.id },
    );

    expect(stored).toBeDefined();
    expect((stored as any)?.prompt).toBe("test task");
    expect((stored as any)?.status).toBe("queued");
  });

  test("3. pushTaskEvent adds to taskEventsByTaskId", async ({ page }) => {
    // Seed a task, push an event, and verify it's stored.
    const task = await seedTaskInPage(page, {
      prompt: "test",
      status: "running",
    });

    await pushTaskEventInPage(page, task.id, {
      type: "message.done",
      message: { role: "user", content: "hello world" },
    });

    // Check that the event was added.
    const events = await page.evaluate(
      ({ taskId }) => {
        const api = (window as any).__test;
        const store = api?.getStore();
        return store?.taskEventsByTaskId?.[taskId] || [];
      },
      { taskId: task.id },
    );

    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    // The event should have been wrapped as a TaskLogEntry
    expect((events[0] as any).taskId).toBe(task.id);
  });

  test("4. default values applied to partial task seed", async ({ page }) => {
    // Seed with minimal params and verify defaults.
    const task = await seedTaskInPage(page, {
      prompt: "minimal",
    });

    // Check defaults were applied.
    expect(task.cli).toBe("codex");
    expect(task.baseRef).toBe("main");
    expect(task.parentSessionId).toBeNull();
    expect(task.title).toBe("Test Task");
    expect(task.status).toBe("queued");
  });

  test("5. running task has startedAt set", async ({ page }) => {
    // Seed a running task and verify startedAt is set.
    const beforeSeed = Date.now();
    const task = await seedTaskInPage(page, {
      prompt: "running task",
      status: "running",
    });
    const afterSeed = Date.now();

    expect(task.startedAt).toBeDefined();
    expect(task.startedAt).toBeGreaterThanOrEqual(beforeSeed);
    expect(task.startedAt).toBeLessThanOrEqual(afterSeed);
  });

  test("6. queued task has no startedAt", async ({ page }) => {
    // Seed a queued task and verify startedAt is null.
    const task = await seedTaskInPage(page, {
      prompt: "queued task",
      status: "queued",
    });

    expect(task.startedAt).toBeNull();
  });

  test("7. task with parentSessionId marked as child", async ({ page }) => {
    // Seed a root task, then seed a child.
    const root = await seedTaskInPage(page, {
      prompt: "root",
      status: "done",
    });

    const child = await seedTaskInPage(page, {
      prompt: "follow-up",
      parentSessionId: root.sessionId,
      sessionId: root.sessionId, // Aggregated into same session
    });

    expect(child.parentSessionId).toBe(root.sessionId);
    expect(child.sessionId).toBe(root.sessionId);
  });

  test("8. store responds to multiple seeded tasks", async ({ page }) => {
    // Seed 3 tasks and verify all are in the store.
    const task1 = await seedTaskInPage(page, { prompt: "task 1" });
    const task2 = await seedTaskInPage(page, { prompt: "task 2" });
    const task3 = await seedTaskInPage(page, { prompt: "task 3" });

    const allTasks = await page.evaluate(() => {
      const api = (window as any).__test;
      const store = api?.getStore();
      const result: Record<string, unknown>[] = [];
      for (const tasks of Object.values(store?.tasksByWorkspaceId || {})) {
        result.push(...(tasks || []));
      }
      return result;
    });

    const taskIds = allTasks.map((t: any) => t.id);
    expect(taskIds).toContain(task1.id);
    expect(taskIds).toContain(task2.id);
    expect(taskIds).toContain(task3.id);
  });
});
