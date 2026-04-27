import { describe, expect, test } from "vitest";
import {
  getCliResumeStrategy,
  isCliMissingResumeSession,
  shouldRetryCliWithoutResume,
} from "../../../../agent/session-resume.ts";

describe("CLI resume retry detection", () => {
  test.each([
    ["claude", "No conversation found with session ID: 7462bca5"],
    ["codex", "failed to record rollout items: thread 019dcc19 not found"],
    ["gemini", "session 1234 not found"],
    ["opencode", "conversation abc not found"],
  ])("detects stale resume stderr for %s", (cli, stderr) => {
    expect(isCliMissingResumeSession(cli, stderr)).toBe(true);
  });

  test.each(["claude", "codex", "gemini", "opencode"])(
    "retries exactly the first failed resume attempt for %s",
    (cli) => {
      const strategy = getCliResumeStrategy(cli);
      expect(strategy?.diagnosticCode).toBe("cli_resume_missing_retry");

      const base = {
        cli,
        resumeSessionId: "stale-session-id",
        stderr:
          cli === "claude"
            ? "No conversation found with session ID: stale"
            : "session stale not found",
        attempt: 0,
        failed: true,
      };

      expect(shouldRetryCliWithoutResume(base)).toBe(true);
      expect(shouldRetryCliWithoutResume({ ...base, attempt: 1 })).toBe(false);
      expect(shouldRetryCliWithoutResume({ ...base, resumeSessionId: null })).toBe(false);
      expect(shouldRetryCliWithoutResume({ ...base, failed: false })).toBe(false);
    },
  );

  test("does not retry unsupported CLIs", () => {
    expect(
      shouldRetryCliWithoutResume({
        cli: "unknown",
        resumeSessionId: "stale",
        stderr: "session stale not found",
        attempt: 0,
        failed: true,
      }),
    ).toBe(false);
  });
});
