import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";

/**
 * Stub adapter for Claude tab during Wave 3 cutover.
 *
 * The full adapter has been disabled temporarily. Use the central composer
 * to create agent tasks instead. This will be re-enabled in a future update.
 */

export const claudeAdapter: ChatModelAdapter = {
  async *run(_options) {
    yield {
      content: [
        {
          type: "text",
          text: "**Wave 3 cutover**: The Claude tab is temporarily unavailable. Use the central composer to create agent tasks. This tab will be re-enabled in a future update.",
        },
      ],
    };
  },
};
