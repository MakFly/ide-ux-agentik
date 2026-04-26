import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { useIDE } from "@/store/ide";

/**
 * Legacy adapter kept for any route that still mounts a local assistant-ui runtime.
 * The main Workspace now owns the runtime directly: first submit creates a task,
 * later submits call task.continue on the active task.
 */
export const taskLauncherAdapter: ChatModelAdapter = {
  async *run(options): AsyncGenerator<ChatModelRunResult, void> {
    const lastMsg = options.messages[options.messages.length - 1];
    if (lastMsg?.role !== "user") return;

    const prompt = lastMsg.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("")
      .trim();

    if (!prompt) return;

    try {
      const store = useIDE.getState();
      const activeTask = store.activeTaskId
        ? ((store.tasksByWorkspaceId[store.activeWorkspaceId] ?? []).find(
            (t) => t.id === store.activeTaskId,
          ) ?? null)
        : null;
      const activeAgent =
        (activeTask?.cli as typeof store.activeAgent | undefined) ??
        store.composerAgentByWorkspaceId[store.activeWorkspaceId] ??
        store.activeAgent;
      const selectedModel = store.selectedModelByCli[activeAgent];
      if (activeTask) {
        await store.continueTaskFromPrompt(activeTask.id, prompt, {
          model: selectedModel,
          effort: activeTask.effort ?? undefined,
        });
      } else {
        console.info(`[taskLauncherAdapter] creating task for prompt: ${prompt.slice(0, 60)}…`);
        await store.createTaskFromPrompt(prompt, {
          cli: activeAgent,
          model: selectedModel,
        });
      }
    } catch (err) {
      console.error("[taskLauncherAdapter] failed:", err);
      yield {
        content: [
          {
            type: "text",
            text: `Failed to create task: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
};
