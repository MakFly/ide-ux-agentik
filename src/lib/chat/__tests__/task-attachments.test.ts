import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  appendTaskAttachmentsToPrompt,
  latestTaskAttachmentBatch,
  materializeTaskAttachments,
  readTaskAttachments,
  stageTaskAttachmentsForWorktree,
} from "../../../../agent/task-attachments.ts";

describe("task attachments", () => {
  test("materializes binary attachments and appends inspectable paths to the runtime prompt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-attachments-"));
    try {
      const attachments = await materializeTaskAttachments(root, "task-1", [
        {
          name: "../kevin lk.png",
          contentType: "image/png",
          kind: "image",
          data: Buffer.from("fake image bytes").toString("base64"),
        },
      ]);

      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.name).toBe("kevin_lk.png");
      expect(attachments[0]?.path).toContain(path.join(".multica", "attachments", "task-1"));
      await expect(readFile(attachments[0]!.path, "utf8")).resolves.toBe("fake image bytes");

      const persisted = await readTaskAttachments(root, "task-1");
      expect(persisted).toEqual(attachments);
      expect(latestTaskAttachmentBatch(persisted)).toEqual(attachments);

      const worktree = path.join(root, ".multica", "tasks", "task-1");
      await mkdir(worktree, { recursive: true });
      const staged = await stageTaskAttachmentsForWorktree(worktree, "task-1", persisted);

      expect(staged).toHaveLength(1);
      expect(staged[0]?.path).toContain(
        path.join(".multica", "tasks", "task-1", ".multica", "runtime-attachments", "task-1"),
      );
      await expect(readFile(staged[0]!.path, "utf8")).resolves.toBe("fake image bytes");

      const prompt = appendTaskAttachmentsToPrompt("describe this", staged);
      expect(prompt).toContain("describe this");
      expect(prompt).toContain("## Attachments");
      expect(prompt).toContain("Inspect the file paths directly");
      expect(prompt).toContain(staged[0]!.path);

      await new Promise((resolve) => setTimeout(resolve, 2));
      const secondBatch = await materializeTaskAttachments(root, "task-1", [
        {
          name: "latest.png",
          contentType: "image/png",
          kind: "image",
          data: Buffer.from("latest image bytes").toString("base64"),
        },
      ]);
      const allPersisted = await readTaskAttachments(root, "task-1");
      expect(latestTaskAttachmentBatch(allPersisted)).toEqual(secondBatch);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
