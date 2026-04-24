/**
 * Per-provider health checks that hit the remote agent via exec.run.
 *
 * Each check returns a CheckResult describing what was verified, whether
 * the binary is installed, whether auth is configured, and what the
 * reported version (or error) was.
 */
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { useIDE } from "@/store/ide";

export type ProviderId = "codex" | "claude" | "opencode" | "gemini";

export type CheckStatus = "unknown" | "running" | "ok" | "warn" | "fail";

export type CheckResult = {
  status: CheckStatus;
  summary: string;
  details: Array<{ label: string; value: string; ok: boolean }>;
  runAt: string; // ISO
};

const DEFAULT_RESULT: CheckResult = {
  status: "unknown",
  summary: "Not checked yet.",
  details: [],
  runAt: "",
};

export function emptyResult(): CheckResult {
  return { ...DEFAULT_RESULT };
}

function getRemoteAgentSource() {
  const { workspaces, activeWorkspaceId } = useIDE.getState();
  const ws = workspaces.find((w) => w.id === activeWorkspaceId);
  if (ws?.source.kind !== "remote-agent") return null;
  return ws.source;
}

async function connectProvider() {
  const source = getRemoteAgentSource();
  if (!source)
    throw new Error(
      "Active workspace is not a remote-agent. Checks require a connected agent.",
    );
  const p = new RemoteAgentProvider(source.label, source.url, source.token);
  await p.connect();
  return p;
}

async function which(provider: RemoteAgentProvider, bin: string) {
  const r = await provider.execRun({ cmd: "which", args: [bin], timeoutMs: 3000 });
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

async function version(provider: RemoteAgentProvider, bin: string, args = ["--version"]) {
  const r = await provider.execRun({ cmd: bin, args, timeoutMs: 5000 });
  return { out: (r.stdout + r.stderr).trim(), exitCode: r.exitCode };
}

function mergeStatus(entries: Array<{ ok: boolean }>, optional: number[] = []): CheckStatus {
  const hardFail = entries.some((e, i) => !e.ok && !optional.includes(i));
  if (hardFail) return "fail";
  const softFail = entries.some((e) => !e.ok);
  return softFail ? "warn" : "ok";
}

// ----- Codex ----------------------------------------------------------------

export async function checkCodex(): Promise<CheckResult> {
  const provider = await connectProvider();
  const details: CheckResult["details"] = [];
  try {
    const path = await which(provider, "codex");
    details.push({
      label: "codex binary",
      value: path ?? "not found on PATH",
      ok: !!path,
    });
    if (path) {
      const v = await version(provider, "codex");
      details.push({
        label: "codex --version",
        value: v.out || `exit ${v.exitCode}`,
        ok: v.exitCode === 0,
      });
    }

    const { codexAuth, codexApiKey } = useIDE.getState();
    details.push({
      label: "ChatGPT login",
      value: codexAuth
        ? `signed in as ${codexAuth.email ?? "user"} (${codexAuth.chatgptPlanType ?? "plan?"})`
        : "not signed in",
      ok: !!codexAuth,
    });
    details.push({
      label: "OPENAI_API_KEY",
      value: codexApiKey ? "configured" : "not set",
      ok: !!codexApiKey,
    });

    const status = !details[0].ok
      ? ("fail" as const)
      : details[2].ok || details[3].ok
        ? ("ok" as const)
        : ("warn" as const);
    const summary = !details[0].ok
      ? "codex not installed on the agent host"
      : status === "ok"
        ? "Ready"
        : "Binary installed but no auth configured";
    return { status, summary, details, runAt: new Date().toISOString() };
  } finally {
    void provider.disconnect();
  }
}

// ----- Claude Code ----------------------------------------------------------

export async function checkClaude(): Promise<CheckResult> {
  const provider = await connectProvider();
  const details: CheckResult["details"] = [];
  try {
    const path = await which(provider, "claude");
    details.push({
      label: "claude binary",
      value: path ?? "not found on PATH",
      ok: !!path,
    });
    if (path) {
      const v = await version(provider, "claude");
      details.push({
        label: "claude --version",
        value: v.out || `exit ${v.exitCode}`,
        ok: v.exitCode === 0,
      });
    }
    // Claude stores auth in ~/.claude/.credentials.json on the agent host —
    // check via exec ls since our FS API is root-jailed.
    const ls = await provider.execRun({
      cmd: "sh",
      args: ["-c", "test -f $HOME/.claude/.credentials.json && echo found || echo missing"],
      timeoutMs: 3000,
    });
    const authed = ls.stdout.trim() === "found";
    details.push({
      label: "~/.claude/.credentials.json",
      value: authed ? "present" : "missing — run `claude login` on the agent host",
      ok: authed,
    });
    const anthropicKey = ls.stdout.includes("ANTHROPIC_API_KEY"); // unused, placeholder
    void anthropicKey;

    return {
      status: mergeStatus(details, /* all required */ []),
      summary: details[0].ok && authed ? "Ready" : "Missing binary or auth",
      details,
      runAt: new Date().toISOString(),
    };
  } finally {
    void provider.disconnect();
  }
}

// ----- OpenCode -------------------------------------------------------------

export async function checkOpenCode(): Promise<CheckResult> {
  const provider = await connectProvider();
  const details: CheckResult["details"] = [];
  try {
    const path = await which(provider, "opencode");
    details.push({
      label: "opencode binary",
      value: path ?? "not found on PATH",
      ok: !!path,
    });
    if (path) {
      const v = await version(provider, "opencode");
      details.push({
        label: "opencode --version",
        value: v.out || `exit ${v.exitCode}`,
        ok: v.exitCode === 0,
      });
    }
    // OpenCode auth is multi-provider; we can only check the config exists.
    const cfg = await provider.execRun({
      cmd: "sh",
      args: [
        "-c",
        "test -f $HOME/.config/opencode/auth.json && echo found || (test -f $HOME/.opencode/auth.json && echo found || echo missing)",
      ],
      timeoutMs: 3000,
    });
    const authed = cfg.stdout.trim() === "found";
    details.push({
      label: "opencode auth config",
      value: authed ? "present" : "missing — run `opencode auth` on the agent host",
      ok: authed,
    });
    return {
      status: mergeStatus(details),
      summary: details[0].ok && authed ? "Ready" : "Missing binary or auth",
      details,
      runAt: new Date().toISOString(),
    };
  } finally {
    void provider.disconnect();
  }
}

// ----- Gemini ---------------------------------------------------------------

export async function checkGemini(): Promise<CheckResult> {
  const provider = await connectProvider();
  const details: CheckResult["details"] = [];
  try {
    const path = await which(provider, "gemini");
    details.push({
      label: "gemini binary",
      value: path ?? "not found on PATH",
      ok: !!path,
    });
    if (path) {
      const v = await version(provider, "gemini");
      details.push({
        label: "gemini --version",
        value: v.out || `exit ${v.exitCode}`,
        ok: v.exitCode === 0,
      });
    }
    const env = await provider.execRun({
      cmd: "sh",
      args: ["-c", 'printf "%s" "${GEMINI_API_KEY:-}${GOOGLE_API_KEY:-}"'],
      timeoutMs: 2000,
    });
    const hasEnvKey = env.stdout.trim().length > 0;
    details.push({
      label: "GEMINI_API_KEY / GOOGLE_API_KEY",
      value: hasEnvKey ? "set in agent env" : "not set",
      ok: hasEnvKey,
    });
    return {
      status: mergeStatus(details),
      summary: details[0].ok && hasEnvKey ? "Ready" : "Missing binary or API key",
      details,
      runAt: new Date().toISOString(),
    };
  } finally {
    void provider.disconnect();
  }
}

export const PROVIDER_CHECKS: Record<ProviderId, () => Promise<CheckResult>> = {
  codex: checkCodex,
  claude: checkClaude,
  opencode: checkOpenCode,
  gemini: checkGemini,
};

export const PROVIDER_META: Record<
  ProviderId,
  { label: string; icon: string; description: string }
> = {
  codex: {
    label: "Codex",
    icon: "/agents/codex.svg",
    description: "OpenAI's terminal coding agent (gpt-5-codex).",
  },
  claude: {
    label: "Claude Code",
    icon: "/agents/claude-code.svg",
    description: "Anthropic's official CLI (claude sonnet/opus).",
  },
  opencode: {
    label: "OpenCode",
    icon: "/agents/opencode.ico",
    description: "Multi-provider open-source CLI (Anthropic, OpenAI, local…).",
  },
  gemini: {
    label: "Gemini CLI",
    icon: "/agents/gemini.svg",
    description: "Google's Gemini agent with 1M context + grounding.",
  },
};
