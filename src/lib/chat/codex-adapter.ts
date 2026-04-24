import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ChatModelRunResult,
  ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { codexExtraArgs } from "@/lib/chat/models";
import { useIDE } from "@/store/ide";
import { persistence } from "@/lib/persistence/client";
import { maybeInterceptSlash } from "@/lib/chat/slash-commands";

/**
 * Plan Mode prefix — verbatim from Piebald-AI's Claude Code system-prompts
 * repo, agent-prompt-plan-mode-enhanced.md (Claude Code v2.1.119, 2026-04-23).
 * Source: https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/agent-prompt-plan-mode-enhanced.md
 */
const PLAN_MODE_SYSTEM_PREFIX = `You are in Plan Mode — a software architect creating a step-by-step implementation plan.

READ-ONLY. Do not modify files, do not run write commands.

Required output — use EXACTLY this structure, nothing else:

## Plan: <one-line title of the plan>

<optional 1-2 sentence context about what you will do>

- [ ] Step 1: <imperative step title> — <short rationale>
- [ ] Step 2: <imperative step title> — <short rationale>
- [ ] Step 3: <imperative step title> — <short rationale>
(aim for 3 to 8 steps; each must start with "- [ ] " and be a single line)

## Follow-up
- <short refinement suggestion the user could ask for>
- <another refinement suggestion>
- <another refinement suggestion>
(3 to 5 items; each a single line, no markdown formatting inside)

Do NOT add any prose, numbered lists, or sections outside of "## Plan" and "## Follow-up". Do NOT write a "Critical Files" section. Do NOT prefix steps with numbers — the "- [ ]" prefix is mandatory.`;

/**
 * assistant-ui adapter that runs `codex exec --json "<prompt>"` via the remote
 * agent and maps the NDJSON event stream to thread message parts.
 *
 * Streaming model: codex emits events in wall-clock order during a turn —
 * narrative `agent_message`s interleaved with `command_execution` start/end
 * pairs. We preserve that order so the UI feels like Copilot Chat (progress
 * text → tool ran → progress text → final answer).
 *
 * Each incoming event mutates an entry in a monotonically-growing parts list
 * keyed by `item.id`; we yield the full list after every change so the Thread
 * re-renders incrementally.
 */

type CodexEvent = {
  type?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    summary?: string;
    tool?: string;
    [k: string]: unknown;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: string;
  text?: string;
  [k: string]: unknown;
};

// Each tracked item keeps both its raw state and the resolved UI part.
// Tool status is derived by assistant-ui: no `result` → running (spinner);
// `result` set → complete; `isError: true` → failed.
type Entry =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      result?: string;
      isError?: boolean;
    }
  | { kind: "note"; text: string };

function getActiveRemoteAgent() {
  const { workspaces, activeWorkspaceId } = useIDE.getState();
  const ws = workspaces.find((w) => w.id === activeWorkspaceId);
  if (ws?.source.kind !== "remote-agent") return null;
  return ws.source;
}

/** Chat history sent to `codex exec` at each turn. Bounded so the prompt
 *  doesn't grow O(N²) across long threads. We keep the N most recent turns
 *  (user + assistant pairs) and further cap total characters. */
const MAX_HISTORY_TURNS = 6;
const MAX_PROMPT_CHARS = 40_000;

/**
 * Parse a Plan-Mode markdown response into a structured `update_plan`-like
 * shape so PlanStepList can render the same UI whether or not Codex emits
 * native plan_update events. Expected format (enforced by
 * PLAN_MODE_SYSTEM_PREFIX):
 *
 *   ## Plan: <title>
 *   <optional explanation>
 *   - [ ] step 1
 *   - [ ] step 2
 *
 *   ## Follow-up
 *   - suggestion 1
 *   - suggestion 2
 */
type ParsedPlan = {
  title?: string;
  explanation?: string;
  steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
  followUps: string[];
};

function parsePlanMarkdown(text: string): ParsedPlan | null {
  if (!text) return null;
  const planMatch = text.match(/##\s*Plan(?::\s*(.+?))?\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!planMatch) return null;
  const title = planMatch[1]?.trim() || undefined;
  const planBody = planMatch[2] ?? "";

  const steps: ParsedPlan["steps"] = [];
  const explanationLines: string[] = [];
  let sawStep = false;
  for (const raw of planBody.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const checkbox = line.match(/^[-*]\s*\[( |x|X|~)\]\s*(.+)$/);
    if (checkbox) {
      sawStep = true;
      const marker = checkbox[1];
      const status =
        marker === "x" || marker === "X"
          ? ("completed" as const)
          : marker === "~"
            ? ("in_progress" as const)
            : ("pending" as const);
      steps.push({ step: checkbox[2].trim(), status });
    } else if (!sawStep) {
      explanationLines.push(line);
    }
  }
  if (steps.length === 0) return null;

  const followMatch = text.match(/##\s*Follow[-\s]?up[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  const followUps: string[] = [];
  if (followMatch) {
    for (const raw of followMatch[1].split(/\r?\n/)) {
      const m = raw.match(/^\s*[-*]\s+(.+)$/);
      if (m) followUps.push(m[1].trim());
    }
  }

  return {
    title,
    explanation: explanationLines.length ? explanationLines.join(" ") : undefined,
    steps,
    followUps,
  };
}

function isPlanModeOn(cli: "codex" | "claude" | "opencode" | "gemini"): boolean {
  try {
    const m = JSON.parse(localStorage.getItem("plan-mode-by-cli") ?? "{}") as Record<
      string,
      boolean
    >;
    return m[cli] === true;
  } catch {
    return false;
  }
}

function flattenMessages(options: ChatModelRunOptions): string {
  // A "turn" = 1 user + 1 assistant message. Slice from the tail.
  const recent = options.messages.slice(-MAX_HISTORY_TURNS * 2);
  const lines: string[] = [];
  for (const m of recent) {
    const text = m.content
      .map((p) => (p.type === "text" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
    if (!text.trim()) continue;
    const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    lines.push(`${role}: ${text}`);
  }
  const out = lines.join("\n\n");
  if (out.length <= MAX_PROMPT_CHARS) return out;
  // Keep the tail so the latest user prompt is always intact.
  return "…[older turns truncated]…\n\n" + out.slice(-MAX_PROMPT_CHARS);
}

function entryToPart(e: Entry): ThreadAssistantMessagePart {
  if (e.kind === "text") return { type: "text", text: e.text };
  if (e.kind === "reasoning") return { type: "reasoning", text: e.text };
  if (e.kind === "note") return { type: "text", text: e.text };
  // tool
  const part: ThreadAssistantMessagePart = {
    type: "tool-call",
    toolCallId: e.id,
    toolName: e.name,
    args: e.args as never,
    argsText: JSON.stringify(e.args),
    result: e.result,
    isError: e.isError,
  };
  return part;
}

function renderParts(order: string[], entries: Map<string, Entry>): ThreadAssistantMessagePart[] {
  const out: ThreadAssistantMessagePart[] = [];
  for (const key of order) {
    const e = entries.get(key);
    if (e) out.push(entryToPart(e));
  }
  return out;
}

async function ensureSessionInDb(
  provider: RemoteAgentProvider,
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  try {
    await persistence.sessions.create(provider, {
      id: sessionId,
      workspaceId,
      cli: "codex",
      title: "Codex session",
    });
    console.debug("[persistence] session ensured", sessionId);
  } catch (e) {
    console.warn("[persistence] sessions.create failed", sessionId, e);
  }
}

export const codexAdapter: ChatModelAdapter = {
  async *run(options): AsyncGenerator<ChatModelRunResult, void> {
    const source = getActiveRemoteAgent();
    if (!source) {
      yield {
        content: [
          {
            type: "text",
            text: "**No remote-agent workspace active.** Open a remote workspace first.",
          },
        ],
      };
      return;
    }

    // Intercept typed builtin slash commands BEFORE flattening / sending.
    // Source: src/lib/chat/slash-commands.ts (inspired by Claude Code
    // src/commands/clear/conversation.ts:49-251).
    const lastMsg = options.messages[options.messages.length - 1];
    const rawLast = (lastMsg?.content ?? [])
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("")
      .trim();
    if (rawLast.startsWith("/")) {
      const { activeWorkspaceId, activeSessionIdByWorkspaceId, workspaces } = useIDE.getState();
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      const handled = await maybeInterceptSlash(rawLast, {
        workspaceSource: ws?.source,
        sessionId: activeSessionIdByWorkspaceId[activeWorkspaceId],
        workspaceId: activeWorkspaceId,
      });
      if (handled) return;
    }

    let prompt = flattenMessages(options);
    if (!prompt.trim()) return;

    // Plan Mode: prefix the prompt with our hardened system prefix when the
    // per-cli toggle is on. The parser below (agent_message handler) promotes
    // the markdown response into a structured plan tool-call when Codex doesn't
    // emit a native update_plan event.
    const planModeOn = isPlanModeOn("codex");
    if (planModeOn) {
      prompt = `${PLAN_MODE_SYSTEM_PREFIX}\n\n---\n\n${prompt}`;
    }

    const provider = (await providerFor(source, source.label)) as RemoteAgentProvider;
    await provider.connect();

    const { activeWorkspaceId, activeSessionIdByWorkspaceId } = useIDE.getState();
    const sessionId = activeSessionIdByWorkspaceId[activeWorkspaceId];

    if (sessionId) {
      await ensureSessionInDb(provider, sessionId, activeWorkspaceId);
      try {
        const userParts =
          options.messages
            .slice(-1)[0]
            ?.content.filter((p) => p.type === "text")
            .map((p) => ({
              type: "text" as const,
              text: (p as { type: "text"; text: string }).text,
            })) ?? [];
        await persistence.messages.append(provider, {
          sessionId,
          role: "user",
          parts: userParts,
        });
        console.debug("[persistence] user message persisted", sessionId, userParts.length, "parts");
      } catch (e) {
        console.warn("[persistence] messages.append (user) failed", sessionId, e);
      }
    } else {
      console.warn("[persistence] skipped user message persist — no sessionId");
    }

    // Ordered keys + entries by key. `agent_message` and `reasoning` items get
    // unique keys even if they reuse the same codex item.id (codex reuses ids
    // occasionally); tool calls are keyed on item.id for started→completed
    // matching.
    const order: string[] = [];
    const entries = new Map<string, Entry>();
    let anon = 0;
    const nextAnon = () => `anon-${++anon}`;

    const upsert = (key: string, entry: Entry) => {
      if (!entries.has(key)) order.push(key);
      entries.set(key, entry);
    };

    // Async queue of events.
    const buffer: CodexEvent[] = [];
    let ended = false;
    // Plan Mode: when Codex emits a native update_plan event, the markdown
    // fallback is disabled for the rest of the turn to avoid double-rendering.
    let hasNativePlanEvent = false;
    type ExitInfo = { code: number | null; signal: string | null };
    let exitInfo: ExitInfo | null = null as ExitInfo | null;
    let notify: (() => void) | null = null;
    const wait = () =>
      new Promise<void>((resolve) => {
        if (buffer.length || ended) return resolve();
        notify = () => {
          notify = null;
          resolve();
        };
      });

    // Read user preferences at spawn time so model/api-key changes apply to the
    // next turn without reloading.
    const { codexModel, codexApiKey } = useIDE.getState();
    const env: Record<string, string> = {};
    if (codexApiKey) env.OPENAI_API_KEY = codexApiKey;

    const handle = await provider.chatSpawn({
      cli: "codex",
      prompt,
      extraArgs: codexExtraArgs(codexModel),
      env: Object.keys(env).length ? env : undefined,
    });

    const offEvent = handle.onEvent((evt) => {
      buffer.push(evt as CodexEvent);
      notify?.();
    });
    const offEnd = handle.onEnd((code, signal) => {
      ended = true;
      exitInfo = { code, signal };
      notify?.();
    });

    const abortListener = () => {
      try {
        handle.kill();
      } catch {
        /* ignore */
      }
    };
    options.abortSignal.addEventListener("abort", abortListener);

    const collectedParts: ThreadAssistantMessagePart[] = [];

    try {
      while (!ended || buffer.length) {
        if (!buffer.length) {
          await wait();
          continue;
        }
        const evt = buffer.shift()!;
        const type = typeof evt.type === "string" ? evt.type : "";
        const itemType = evt.item && typeof evt.item.type === "string" ? evt.item.type : "";
        const itemId = evt.item && typeof evt.item.id === "string" ? evt.item.id : undefined;

        if (type === "item.started") {
          if (itemType === "command_execution" && itemId) {
            upsert(`tool:${itemId}`, {
              kind: "tool",
              id: itemId,
              name: "shell",
              args: { command: typeof evt.item?.command === "string" ? evt.item.command : "" },
            });
          } else if (itemType === "mcp_tool_call" && itemId) {
            upsert(`tool:${itemId}`, {
              kind: "tool",
              id: itemId,
              name: typeof evt.item?.tool === "string" ? evt.item.tool : "mcp",
              args: (evt.item ?? {}) as Record<string, unknown>,
            });
          }
        } else if (type === "item.updated" || type === "item.completed") {
          void type;
          if (itemType === "agent_message") {
            const t = typeof evt.item?.text === "string" ? evt.item.text : "";
            if (t) {
              // Plan Mode fallback: if Codex didn't emit a native
              // update_plan event and the text parses as our hardened
              // markdown plan, promote it into a structured plan tool
              // entry so PlanStepList renders instead of a wall of text.
              let promoted = false;
              if (planModeOn && !hasNativePlanEvent) {
                const parsed = parsePlanMarkdown(t);
                if (parsed) {
                  const planKey = itemId ? `plan:msg:${itemId}` : `plan:${nextAnon()}`;
                  upsert(planKey, {
                    kind: "tool",
                    id: itemId ?? planKey,
                    name: "plan",
                    args: {
                      title: parsed.title,
                      explanation: parsed.explanation,
                      steps: parsed.steps,
                      followUps: parsed.followUps,
                    } as Record<string, unknown>,
                    result: "ok",
                  });
                  console.debug(
                    `[plan] promoted agent_message → ${parsed.steps.length} steps, ${parsed.followUps.length} follow-ups`,
                  );
                  promoted = true;
                }
              }
              if (!promoted) {
                const key = itemId ? `msg:${itemId}` : nextAnon();
                upsert(key, { kind: "text", text: t });
              }
            }
          } else if (itemType === "reasoning") {
            const t = typeof evt.item?.text === "string" ? evt.item.text : "";
            if (t) {
              const key = itemId ? `think:${itemId}` : nextAnon();
              upsert(key, { kind: "reasoning", text: t });
            }
          } else if (itemType === "command_execution" && itemId) {
            const cmd = typeof evt.item?.command === "string" ? evt.item.command : "";
            const stdout = typeof evt.item?.stdout === "string" ? evt.item.stdout : "";
            const stderr = typeof evt.item?.stderr === "string" ? evt.item.stderr : "";
            const exitCode =
              typeof evt.item?.exit_code === "number" ? evt.item.exit_code : undefined;
            const out = [stdout, stderr].filter(Boolean).join("\n").trim();
            // Only set `result` when the item is completed: leaving it undefined
            // during `item.updated` keeps the spinner state in the UI.
            const isCompleted = type === "item.completed";
            upsert(`tool:${itemId}`, {
              kind: "tool",
              id: itemId,
              name: "shell",
              args: { command: cmd },
              result: isCompleted
                ? out || (exitCode !== undefined ? `(exit ${exitCode})` : "(no output)")
                : undefined,
              isError: isCompleted && !!exitCode && exitCode !== 0,
            });
          } else if (itemType === "mcp_tool_call" && itemId) {
            const isCompleted = type === "item.completed";
            upsert(`tool:${itemId}`, {
              kind: "tool",
              id: itemId,
              name: typeof evt.item?.tool === "string" ? evt.item.tool : "mcp",
              args: (evt.item ?? {}) as Record<string, unknown>,
              result: isCompleted ? JSON.stringify(evt.item ?? {}, null, 2) : undefined,
            });
          } else if (itemType === "file_change") {
            const summary =
              typeof evt.item?.summary === "string" ? evt.item.summary : "file change";
            const key = itemId ? `file:${itemId}` : nextAnon();
            upsert(key, { kind: "note", text: `📝 ${summary}` });
          } else if (itemType === "web_search") {
            const q = typeof evt.item?.query === "string" ? evt.item.query : "";
            const key = itemId ? `web:${itemId}` : nextAnon();
            upsert(key, { kind: "note", text: `🔎 web search${q ? ` · ${q}` : ""}` });
          } else if (itemType === "plan_update") {
            // Codex native update_plan tool events.
            // Source: openai/codex-rs/tools/src/plan_tool.rs — schema:
            //   { explanation?: string, plan: Array<{ step: string, status: "pending"|"in_progress"|"completed" }> }
            const rawPlan = evt.item?.plan;
            const explanation =
              typeof evt.item?.explanation === "string" ? evt.item.explanation : undefined;
            const steps = Array.isArray(rawPlan)
              ? rawPlan
                  .filter((p) => p && typeof p === "object")
                  .map((p) => {
                    const obj = p as { step?: unknown; status?: unknown };
                    const step = typeof obj.step === "string" ? obj.step : "";
                    const status =
                      obj.status === "in_progress" || obj.status === "completed"
                        ? obj.status
                        : "pending";
                    return { step, status };
                  })
                  .filter((s) => s.step.length > 0)
              : [];
            const key = itemId ? `plan:${itemId}` : nextAnon();
            if (steps.length > 0) {
              hasNativePlanEvent = true;
              const allDone = steps.every((s) => s.status === "completed");
              upsert(key, {
                kind: "tool",
                id: itemId ?? key,
                name: "plan",
                args: { explanation, steps } as Record<string, unknown>,
                result: allDone ? "ok" : undefined,
              });
            } else {
              // Fallback: stringified plan (non-standard payload) — keep as a note.
              const fallback =
                typeof rawPlan === "string" ? rawPlan : JSON.stringify(rawPlan ?? {});
              upsert(key, { kind: "note", text: `🗂 ${fallback}` });
            }
          }
        } else if (type === "stderr") {
          // Raw stderr chunks from codex itself — usually setup chatter. Skip
          // the "Reading additional input from stdin..." noise.
          const txt = typeof evt.text === "string" ? evt.text : "";
          if (txt.trim() && !/Reading additional input/i.test(txt)) {
            upsert(nextAnon(), { kind: "note", text: txt.trim() });
          }
        } else if (type === "error") {
          const msg = typeof evt.message === "string" ? evt.message : JSON.stringify(evt);
          upsert(nextAnon(), { kind: "note", text: `⚠️ ${msg}` });
        } else if (type === "turn.failed") {
          upsert(nextAnon(), { kind: "note", text: "⚠️ Turn failed" });
        }

        const rendered = renderParts(order, entries);
        collectedParts.splice(0, collectedParts.length, ...rendered);
        yield { content: rendered };
      }

      if (exitInfo && exitInfo.code !== 0 && order.length === 0) {
        const fallback: ThreadAssistantMessagePart = {
          type: "text",
          text: `codex exited with code=${exitInfo.code} signal=${exitInfo.signal ?? "null"}`,
        };
        collectedParts.push(fallback);
        yield { content: [fallback] };
      }
    } finally {
      offEvent();
      offEnd();
      options.abortSignal.removeEventListener("abort", abortListener);

      if (sessionId && collectedParts.length > 0) {
        try {
          await persistence.messages.append(provider, {
            sessionId,
            role: "assistant",
            parts: collectedParts.map((p) => {
              if (p.type === "text") return { type: "text", text: p.text };
              if (p.type === "reasoning") return { type: "reasoning", text: p.text };
              if (p.type === "tool-call")
                return {
                  type: "tool-call",
                  toolName: p.toolName,
                  args: p.args,
                  result: p.result,
                  isError: p.isError,
                };
              return { type: "text", text: JSON.stringify(p) };
            }),
          });
          console.debug(
            "[persistence] assistant message persisted",
            sessionId,
            collectedParts.length,
            "parts",
          );
        } catch (e) {
          console.warn("[persistence] messages.append (assistant) failed", sessionId, e);
        }
      }
    }
  },
};
