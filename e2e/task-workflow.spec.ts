import { expect, test } from "@playwright/test";
import {
  seedTaskInPage,
  pushTaskEventInPage,
  waitForTestAPI,
  pushCodexEventSequenceInPage,
  clearAllSessionsInPage,
  getActiveWorkspaceId,
} from "./test-helpers";

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

  test("9. reducer dedups top-level assistant_message vs item.completed", async ({ page }) => {
    // Verify that when both item.completed{assistant_message} and top-level
    // assistant_message have the same text, the reducer produces 1 item only.
    await waitForTestAPI(page);

    const result = await page.evaluate(() => {
      const events = [
        {
          id: -1,
          taskId: "t1",
          ts: 1,
          level: "info",
          source: "stdout",
          data: { type: "thread.started" },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 2,
          level: "info",
          source: "stdout",
          data: { type: "turn.started" },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 3,
          level: "info",
          source: "stdout",
          data: {
            type: "item.completed",
            item: { id: "i0", type: "assistant_message", text: "Hello world" },
          },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 4,
          level: "info",
          source: "stdout",
          data: { type: "assistant_message", text: "Hello world" },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 5,
          level: "info",
          source: "stdout",
          data: { type: "turn.completed" },
        },
      ];

      const api = (window as any).__test;
      if (!api?.reduceCodex) {
        throw new Error("__test.reduceCodex not available");
      }
      const state = api.reduceCodex(events, "");
      const assistantItems = Object.values(state.itemsById).filter(
        (it: any) => it.kind === "assistant_text",
      );
      return {
        count: assistantItems.length,
        texts: assistantItems.map((it: any) => it.text),
      };
    });

    expect(result.count).toBe(1);
    expect(result.texts).toEqual(["Hello world"]);
  });

  test("10. reasoning streams while running and completes with durationMs", async ({ page }) => {
    // Verify that reasoning deltas accumulate and durationMs is set on completion.
    await waitForTestAPI(page);

    const result = await page.evaluate(() => {
      const events = [
        {
          id: -1,
          taskId: "t1",
          ts: 1000,
          level: "info",
          source: "stdout",
          data: { type: "thread.started" },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 1001,
          level: "info",
          source: "stdout",
          data: { type: "turn.started" },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 1002,
          level: "info",
          source: "stdout",
          data: { type: "item.started", item: { id: "r0", type: "reasoning" } },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 1100,
          level: "info",
          source: "stdout",
          data: { type: "reasoning", text: "Hmm, ", delta: true },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 1200,
          level: "info",
          source: "stdout",
          data: { type: "reasoning", text: "let me think.", delta: true },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 1500,
          level: "info",
          source: "stdout",
          data: {
            type: "item.completed",
            item: { id: "r0", type: "reasoning", text: "Hmm, let me think." },
          },
        },
      ];

      const api = (window as any).__test;
      if (!api?.reduceCodex) {
        throw new Error("__test.reduceCodex not available");
      }
      const state = api.reduceCodex(events, "");
      const reasoning = Object.values(state.itemsById).find(
        (it: any) => it.kind === "reasoning",
      ) as any;
      return {
        text: reasoning?.text,
        durationMs: reasoning?.durationMs,
        completedAt: reasoning?.completedAt,
      };
    });

    expect(result.text).toBe("Hmm, let me think.");
    expect(result.durationMs).toBe(498); // 1500 - 1002
    expect(result.completedAt).toBe(1500);
  });

  test("11. tool_call item parses command_execution with exit code", async ({ page }) => {
    // Verify that command_execution items are converted to tool_call items
    // with proper status, command, output, and exitCode.
    await waitForTestAPI(page);

    const result = await page.evaluate(() => {
      const events = [
        {
          id: -1,
          taskId: "t1",
          ts: 100,
          level: "info",
          source: "stdout",
          data: { type: "thread.started" },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 101,
          level: "info",
          source: "stdout",
          data: { type: "turn.started" },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 102,
          level: "info",
          source: "stdout",
          data: {
            type: "item.started",
            item: { id: "c0", type: "command_execution", command: "ls -la" },
          },
        },
        {
          id: -1,
          taskId: "t1",
          ts: 200,
          level: "info",
          source: "stdout",
          data: {
            type: "item.completed",
            item: {
              id: "c0",
              type: "command_execution",
              command: "ls -la",
              aggregated_output: "total 8\ndrwxr-xr-x",
              exit_code: 0,
            },
          },
        },
      ];

      const api = (window as any).__test;
      if (!api?.reduceCodex) {
        throw new Error("__test.reduceCodex not available");
      }
      const state = api.reduceCodex(events, "");
      const tool = Object.values(state.itemsById).find((it: any) => it.kind === "tool_call") as any;
      return {
        toolName: tool?.toolName,
        command: tool?.command,
        output: tool?.output,
        exitCode: tool?.exitCode,
        status: tool?.status,
      };
    });

    expect(result.toolName).toBe("exec");
    expect(result.command).toBe("ls -la");
    expect(result.output).toContain("total 8");
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("completed");
  });

  test("12. seeding child task does not create implicit session tabs", async ({ page }) => {
    // The central Thread is now the stable task surface. Tasks should not be
    // mirrored into WorkspaceTerminal tabs as a navigation side effect.
    await page.goto("/");
    await waitForTestAPI(page);
    await clearAllSessionsInPage(page);

    const wsId = await getActiveWorkspaceId(page);

    // Seed root task A
    const rootSessionId = "root-session-uuid";
    await seedTaskInPage(page, {
      id: "root-task",
      sessionId: rootSessionId,
      workspaceId: wsId,
      title: "Root",
      prompt: "do X",
      cli: "codex",
      status: "done",
      parentSessionId: null,
    });

    let tabCount = await page.evaluate((wsId) => {
      const api = (window as any).__test;
      const store = api.getStore();
      return (store.sessionsByWorkspaceId[wsId] ?? []).length;
    }, wsId);
    expect(tabCount).toBe(0);

    // Seed child task B with parentSessionId = root.sessionId
    await seedTaskInPage(page, {
      id: "child-task",
      sessionId: "child-session-uuid",
      workspaceId: wsId,
      title: "Follow-up",
      prompt: "and Y",
      cli: "codex",
      status: "running",
      parentSessionId: rootSessionId,
    });

    tabCount = await page.evaluate((wsId) => {
      const api = (window as any).__test;
      const store = api.getStore();
      return (store.sessionsByWorkspaceId[wsId] ?? []).length;
    }, wsId);
    expect(tabCount).toBe(0);

    const taskIds = await page.evaluate((wsId) => {
      const api = (window as any).__test;
      const store = api.getStore();
      return (store.tasksByWorkspaceId[wsId] ?? []).map((task: any) => task.id);
    }, wsId);
    expect(taskIds).toContain("root-task");
    expect(taskIds).toContain("child-task");
  });

  test("13. multiple conversation tasks do not produce tabs", async ({ page }) => {
    // Legacy child rows may still hydrate, but the new Thread workflow no
    // longer mirrors them into session tabs.
    await page.goto("/");
    await waitForTestAPI(page);
    await clearAllSessionsInPage(page);

    const wsId = await getActiveWorkspaceId(page);
    const rootSessionId = "convo-root";

    // Seed root + 2 children IN ORDER (oldest first to mimic hydrate)
    await seedTaskInPage(page, {
      id: "t1",
      sessionId: rootSessionId,
      workspaceId: wsId,
      title: "Root",
      prompt: "p1",
      cli: "codex",
      status: "done",
      parentSessionId: null,
      createdAt: 1000,
    });
    await seedTaskInPage(page, {
      id: "t2",
      sessionId: "c1-session",
      workspaceId: wsId,
      title: "Child 1",
      prompt: "p2",
      cli: "codex",
      status: "done",
      parentSessionId: rootSessionId,
      createdAt: 2000,
    });
    await seedTaskInPage(page, {
      id: "t3",
      sessionId: "c2-session",
      workspaceId: wsId,
      title: "Child 2",
      prompt: "p3",
      cli: "codex",
      status: "running",
      parentSessionId: rootSessionId,
      createdAt: 3000,
    });

    const result = await page.evaluate((wsId) => {
      const api = (window as any).__test;
      const store = api.getStore();
      const sessions = store.sessionsByWorkspaceId[wsId] ?? [];
      const tasks = store.tasksByWorkspaceId[wsId] ?? [];
      return {
        sessionCount: sessions.length,
        taskCount: tasks.length,
      };
    }, wsId);

    expect(result.taskCount).toBe(3);
    expect(result.sessionCount).toBe(0);
  });

  test("14. closing temporary CLI session restores previous task session context", async ({ page }) => {
    await page.goto("/");
    await waitForTestAPI(page);
    await clearAllSessionsInPage(page);

    const wsId = await getActiveWorkspaceId(page);

    await page.evaluate(() => {
      const api = (window as any).__test.getStore();
      api.addAgentSession("codex");
    });
    const baseSessionBefore = await page.evaluate((wsIdToCheck) => {
      const api = (window as any).__test.getStore();
      const sessions = api.sessionsByWorkspaceId[wsIdToCheck] ?? [];
      return sessions[sessions.length - 1]?.id;
    }, wsId);
    expect(baseSessionBefore).toBeDefined();

    const baseSessionId = baseSessionBefore;

    const task = await seedTaskInPage(page, {
      id: "restore-task",
      sessionId: baseSessionId,
      workspaceId: wsId,
      title: "Existing task",
      prompt: "Existing task prompt",
      cli: "codex",
      status: "done",
    });

    await page.evaluate((taskId) => {
      const store = (window as any).__test?.getStore();
      if (!store?.setActiveTask) throw new Error("__test store setActiveTask unavailable");
      store.setActiveTask(taskId);
    }, task.id);

    const before = await page.evaluate((wsIdToCheck) => {
      const api = (window as any).__test.getStore();
      return {
        activeTaskId: api.activeTaskId,
        activeSessionId: api.activeSessionIdByWorkspaceId[wsIdToCheck],
        sessionCount: (api.sessionsByWorkspaceId[wsIdToCheck] ?? []).length,
      };
    }, wsId);
    expect(before.activeTaskId).toBe(task.id);
    expect(before.activeSessionId).toBe(baseSessionId);

    const tempSessionId = await page.evaluate(() => {
      const api = (window as any).__test.getStore();
      api.setActiveTask(null);
      api.setActiveSession("");
      api.addAgentSession("codex");
      const nextApi = (window as any).__test.getStore();
      const sessions = nextApi.sessionsByWorkspaceId[nextApi.activeWorkspaceId] ?? [];
      return sessions[sessions.length - 1]?.id;
    });
    const whileOpen = await page.evaluate((wsIdToCheck) => {
      const api = (window as any).__test.getStore();
      return {
        activeTaskId: api.activeTaskId,
        activeSessionId: api.activeSessionIdByWorkspaceId[wsIdToCheck],
        sessionCount: (api.sessionsByWorkspaceId[wsIdToCheck] ?? []).length,
      };
    }, wsId);
    expect(whileOpen.activeTaskId).toBeNull();
    expect(whileOpen.activeSessionId).toBe(tempSessionId);
    expect(whileOpen.sessionCount).toBe(2);

    await page.evaluate((sid) => {
      const api = (window as any).__test.getStore();
      api.closeAgentSession(sid);
    }, tempSessionId);

    const after = await page.evaluate((wsIdToCheck) => {
      const api = (window as any).__test.getStore();
      return {
        activeTaskId: api.activeTaskId,
        activeSessionId: api.activeSessionIdByWorkspaceId[wsIdToCheck],
        sessionIds: (api.sessionsByWorkspaceId[wsIdToCheck] ?? []).map((session: any) => session.id),
        sessionCount: (api.sessionsByWorkspaceId[wsIdToCheck] ?? []).length,
      };
    }, wsId);

    expect(after.activeSessionId).toBe(baseSessionId);
    expect(after.activeTaskId).toBe(task.id);
    expect(after.sessionCount).toBe(1);
  });

  test("15. closing temporary non-task CLI restores previous task tab and its cached data", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForTestAPI(page);
    await clearAllSessionsInPage(page);

    const wsId = await getActiveWorkspaceId(page);

    const task = await seedTaskInPage(page, {
      id: "restore-task-data",
      sessionId: "restore-task-session",
      workspaceId: wsId,
      title: "Existing task for restore",
      prompt: "Existing task prompt",
      cli: "codex",
      status: "done",
    });

    await pushTaskEventInPage(page, task.id, {
      type: "assistant_message",
      text: "message-before-close",
    });

    await page.evaluate((taskId) => {
      const store = (window as any).__test.getStore();
      store.setActiveTask(taskId);
    }, task.id);

    const tempSessionId = await page.evaluate(() => {
      const store = (window as any).__test.getStore();
      store.setActiveTask(null);
      store.setActiveSession("");
      return store.addAgentSession("codex");
    });

    const whileOpen = await page.evaluate((wsIdToCheck) => {
      const store = (window as any).__test.getStore();
      return {
        activeTaskId: store.activeTaskId,
        activeSessionId: store.activeSessionIdByWorkspaceId[wsIdToCheck],
        sessionCount: (store.sessionsByWorkspaceId[wsIdToCheck] ?? []).length,
      };
    }, wsId);
    expect(whileOpen.activeTaskId).toBeNull();
    expect(whileOpen.activeSessionId).not.toBe(task.sessionId);
    expect(whileOpen.activeSessionId).toBe(tempSessionId);
    expect(whileOpen.sessionCount).toBe(2);

    await page.evaluate((tempSid) => {
      const store = (window as any).__test.getStore();
      store.closeAgentSession(tempSid);
    }, tempSessionId);

    const after = await page.evaluate(({ taskId, wsIdToCheck }) => {
      const store = (window as any).__test.getStore();
      return {
        activeTaskId: store.activeTaskId,
        activeSessionId: store.activeSessionIdByWorkspaceId[wsIdToCheck],
        sessionCount: (store.sessionsByWorkspaceId[wsIdToCheck] ?? []).length,
        taskEvents: (store.taskEventsByTaskId[taskId] ?? []).length,
      };
    }, { taskId: task.id, wsIdToCheck: wsId });

    expect(after.activeTaskId).toBe(task.id);
    expect(after.activeSessionId).toBe(task.sessionId);
    expect(after.sessionCount).toBe(1);
    expect(after.taskEvents).toBe(1);
  });

  test("16. closing active task CLI restores fallback non-task CLI", async ({ page }) => {
    await page.goto("/");
    await waitForTestAPI(page);
    await clearAllSessionsInPage(page);

    const wsId = await getActiveWorkspaceId(page);

    const tempSessionId = await page.evaluate(() => {
      const store = (window as any).__test.getStore();
      return store.addAgentSession("codex");
    });

    const task = await seedTaskInPage(page, {
      id: "restore-fallback-task",
      sessionId: "restore-fallback-session",
      workspaceId: wsId,
      title: "Task restored after closing",
      prompt: "Prompt",
      cli: "codex",
      status: "done",
    });

    await page.evaluate((taskId) => {
      const store = (window as any).__test.getStore();
      store.setActiveTask(taskId);
    }, task.id);

    await page.evaluate((taskSessionId) => {
      const store = (window as any).__test.getStore();
      store.closeSessionTab(taskSessionId);
    }, task.sessionId);

    const after = await page.evaluate(({ tempSidToCheck, wsIdToCheck }) => {
      const store = (window as any).__test.getStore();
      return {
        activeTaskId: store.activeTaskId,
        activeSessionId: store.activeSessionIdByWorkspaceId[wsIdToCheck],
        sessionCount: (store.sessionsByWorkspaceId[wsIdToCheck] ?? []).length,
        hasTempSession: (store.sessionsByWorkspaceId[wsIdToCheck] ?? []).some(
          (session: { id: string }) => session.id === tempSidToCheck,
        ),
      };
    }, { tempSidToCheck: tempSessionId, wsIdToCheck: wsId });

    expect(after.activeTaskId).toBeNull();
    expect(after.activeSessionId).toBe(tempSessionId);
    expect(after.sessionCount).toBe(1);
    expect(after.hasTempSession).toBe(true);
  });
});
