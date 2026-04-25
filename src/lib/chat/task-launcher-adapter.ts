import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ChatModelRunResult,
} from "@assistant-ui/react";
import { useIDE } from "@/store/ide";

/**
 * Task launcher adapter for the central composer.
 *
 * Instead of running a chat session, this adapter intercepts the submit and creates
 * a new agent task via store.createTaskFromPrompt. The task then executes in its own
 * worktree with event streaming to the TaskDetailDialog Transcript tab.
 *
 * Wave 3: central composer no longer pushes messages into a chat session. It launches tasks.
 */
export const taskLauncherAdapter: ChatModelAdapter = {
  async *run(options): AsyncGenerator<ChatModelRunResult, void> {
    // Extract the last user message as the task prompt.
    const lastMsg = options.messages[options.messages.length - 1];
    if (lastMsg?.role !== "user") {
      yield {
        content: [{ type: "text", text: "Invalid message: expected user role" }],
      };
      return;
    }

    const promptParts = lastMsg.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("");

    if (!promptParts.trim()) {
      yield {
        content: [{ type: "text", text: "Empty prompt" }],
      };
      return;
    }

    // Launch the task via store action.
    try {
      const store = useIDE.getState();
      const activeAgent = store.activeAgent;
      const selectedModel = store.selectedModelByCli[activeAgent];

      console.info(
        `[taskLauncherAdapter] creating task for prompt: ${promptParts.slice(0, 60)}...`,
      );
      await store.createTaskFromPrompt(promptParts, {
        cli: activeAgent,
        model: selectedModel,
      });

      // Yield a friendly message that the task was created.
      // The actual execution happens in the TaskDetailDialog transcript.
      yield {
        content: [
          {
            type: "text",
            text: "Task created and started. View progress in the task detail dialog.",
          },
        ],
      };
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
