import { Page } from "@playwright/test";
import type { Task } from "@/lib/fs/remote-agent";

/**
 * Seed a task into the IDE store via the development test API.
 * Returns a promise that resolves when the store is ready.
 */
export async function seedTaskInPage(page: Page, partial: Partial<Task>): Promise<Task> {
  // Ensure the store is available
  await waitForTestAPI(page);

  // Build full task with sensible defaults
  const task: Task = {
    id: partial.id ?? crypto.randomUUID(),
    sessionId: partial.sessionId ?? crypto.randomUUID(),
    workspaceId: partial.workspaceId ?? (await getActiveWorkspaceId(page)),
    parentSessionId: partial.parentSessionId ?? null,
    title: partial.title ?? "Test Task",
    prompt: partial.prompt ?? "test prompt",
    cli: partial.cli ?? "codex",
    model: partial.model ?? null,
    effort: partial.effort ?? null,
    status: partial.status ?? "queued",
    worktreePath: partial.worktreePath ?? null,
    branchName: partial.branchName ?? null,
    baseRef: partial.baseRef ?? "main",
    exitCode: partial.exitCode ?? null,
    errorMessage: partial.errorMessage ?? null,
    agentSessionId: partial.agentSessionId ?? null,
    createdAt: partial.createdAt ?? Date.now(),
    startedAt: partial.startedAt ?? (partial.status === "running" ? Date.now() : null),
    endedAt: partial.endedAt ?? null,
    parentTaskId: partial.parentTaskId ?? null,
  };

  // Inject into store
  await page.evaluate((t) => {
    const api = (window as any).__test;
    if (!api?.seedTask) throw new Error("__test.seedTask not available");
    api.seedTask(t);
  }, task);

  return task;
}

/**
 * Push a task event into the store. Useful for simulating streaming responses.
 */
export async function pushTaskEventInPage(
  page: Page,
  taskId: string,
  event: unknown,
): Promise<void> {
  await waitForTestAPI(page);
  await page.evaluate(
    ({ tid, evt }) => {
      const api = (window as any).__test;
      if (!api?.pushTaskEvent) throw new Error("__test.pushTaskEvent not available");
      api.pushTaskEvent(tid, evt);
    },
    { tid: taskId, evt: event },
  );
}

/**
 * Get the current active workspace ID.
 */
export async function getActiveWorkspaceId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const api = (window as any).__test;
    if (!api?.getStore) throw new Error("__test.getStore not available");
    const store = api.getStore();
    return store.activeWorkspaceId;
  });
}

/**
 * Close an agent session by its ID.
 */
export async function closeAgentSessionInPage(page: Page, sessionId: string): Promise<void> {
  await waitForTestAPI(page);
  await page.evaluate(
    ({ sid }) => {
      const api = (window as any).__test;
      if (!api?.getStore) throw new Error("__test.getStore not available");
      const store = api.getStore();
      store.closeAgentSession(sid);
    },
    { sid: sessionId },
  );
}

/**
 * Remove a task by ID.
 */
export async function removeTaskInPage(page: Page, taskId: string): Promise<void> {
  await waitForTestAPI(page);
  await page.evaluate(
    ({ tid }) => {
      const api = (window as any).__test;
      if (!api?.getStore) throw new Error("__test.getStore not available");
      const store = api.getStore();
      store.removeTaskById(tid);
    },
    { tid: taskId },
  );
}

/**
 * Get all tasks currently in the store.
 */
export async function getAllTasksInPage(page: Page): Promise<Task[]> {
  return page.evaluate(() => {
    const api = (window as any).__test;
    if (!api?.getStore) throw new Error("__test.getStore not available");
    const store = api.getStore();
    const allTasks: Task[] = [];
    for (const tasks of Object.values(store.tasksByWorkspaceId || {})) {
      allTasks.push(...(tasks || []));
    }
    return allTasks;
  });
}

/**
 * Wait for the test API to be available on the window.
 */
export async function waitForTestAPI(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__test, null, { timeout: timeoutMs });
}

/**
 * Close all agent sessions and clear the tasks.
 */
export async function clearAllSessionsInPage(page: Page): Promise<void> {
  await waitForTestAPI(page);
  await page.evaluate(() => {
    const api = (window as any).__test;
    if (!api?.getStore) throw new Error("__test.getStore not available");
    const store = api.getStore();
    const sessionIds: string[] = [];
    for (const sessions of Object.values(store.sessionsByWorkspaceId || {})) {
      for (const session of sessions || []) {
        sessionIds.push((session as any).id);
      }
    }
    sessionIds.forEach((sid: string) => {
      try {
        store.closeAgentSession(sid);
      } catch {
        // ignore
      }
    });
  });
}

/**
 * Push a sequence of codex events into the store for a task.
 * Useful for simulating a complete event stream (reasoning, tools, etc).
 */
export async function pushCodexEventSequenceInPage(
  page: Page,
  taskId: string,
  events: Array<{ ts?: number; data: unknown }>,
): Promise<void> {
  await waitForTestAPI(page);
  await page.evaluate(
    ({ tid, evts }) => {
      const api = (window as any).__test;
      if (!api?.pushTaskEvent) throw new Error("__test.pushTaskEvent not available");
      for (const e of evts) {
        api.pushTaskEvent(tid, e.data);
      }
    },
    { tid: taskId, evts: events },
  );
}
