export type CliResumeRetryInput = {
  cli: string;
  resumeSessionId: string | null | undefined;
  stderr: string;
  attempt: number;
  failed: boolean;
};

export type CliResumeStrategy = {
  cli: string;
  diagnosticCode: string;
  diagnosticMessage: string;
  staleSessionPatterns: RegExp[];
};

const GENERIC_STALE_SESSION_PATTERNS = [
  /conversation .*not found/i,
  /session .*not found/i,
  /thread .*not found/i,
  /resume .*not found/i,
];

const RESUME_STRATEGIES: Record<string, CliResumeStrategy> = {
  claude: {
    cli: "claude",
    diagnosticCode: "cli_resume_missing_retry",
    diagnosticMessage: "CLI resume session was stale; retrying this turn without resume.",
    staleSessionPatterns: [/No conversation found with session ID/i],
  },
  codex: {
    cli: "codex",
    diagnosticCode: "cli_resume_missing_retry",
    diagnosticMessage: "CLI resume session was stale; retrying this turn without resume.",
    staleSessionPatterns: [
      /thread .*not found/i,
      /rollout items: thread .*not found/i,
      ...GENERIC_STALE_SESSION_PATTERNS,
    ],
  },
  gemini: {
    cli: "gemini",
    diagnosticCode: "cli_resume_missing_retry",
    diagnosticMessage: "CLI resume session was stale; retrying this turn without resume.",
    staleSessionPatterns: GENERIC_STALE_SESSION_PATTERNS,
  },
  opencode: {
    cli: "opencode",
    diagnosticCode: "cli_resume_missing_retry",
    diagnosticMessage: "CLI resume session was stale; retrying this turn without resume.",
    staleSessionPatterns: GENERIC_STALE_SESSION_PATTERNS,
  },
};

export function getCliResumeStrategy(cli: string): CliResumeStrategy | null {
  return RESUME_STRATEGIES[cli] ?? null;
}

export function isCliMissingResumeSession(cli: string, stderr: string): boolean {
  const strategy = getCliResumeStrategy(cli);
  if (!strategy) return false;
  return strategy.staleSessionPatterns.some((pattern) => pattern.test(stderr));
}

export function shouldRetryCliWithoutResume(input: CliResumeRetryInput): boolean {
  return (
    input.failed &&
    Boolean(input.resumeSessionId) &&
    input.attempt === 0 &&
    isCliMissingResumeSession(input.cli, input.stderr)
  );
}
