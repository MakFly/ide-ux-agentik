import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ChatModelRunResult,
  ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { claudeExtraArgs } from "@/lib/chat/models";
import { getReasoningEffort } from "@/components/ide/reasoning-pill";
import { supportsOneM } from "@/lib/chat/context-windows";
import { useIDE } from "@/store/ide";
import { persistence } from "@/lib/persistence/client";
import { maybeInterceptSlash } from "@/lib/chat/slash-commands";
import { PLAN_MODE_SYSTEM_PREFIX, parsePlanMarkdown, isPlanModeOn } from "@/lib/chat/plan-mode";

/**
 * assistant-ui adapter that runs `claude -p <prompt> --output-format stream-json
 * --verbose` via the remote agent and maps the NDJSON event stream to thread
 * message parts.
 *
 * Event schema (Claude Code CLI, April 2026):
 *   { type: "system", subtype: "init", session_id, tools, ... }
 *   { type: "assistant", message: { role, content: [{type:"text"|"tool_use"|"thinking", ...}] } }
 *   { type: "user", message: { role, content: [{type:"tool_result", tool_use_id, content}] } }
 *   { type: "result", subtype: "success"|"error_max_turns"|"error", result, usage }
 *
 * `claude -p` is one-shot (no session state server-side). We resend a bounded
 * transcript each turn — same approach as codex-adapter.ts.
 */

type ClaudeContentBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  thinking?: string;
  [k: string]: unknown;
};

type ClaudeEvent = {
  type?: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: ClaudeContentBlock[];
    [k: string]: unknown;
  };
  session_id?: string;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  text?: string;
  [k: string]: unknown;
};

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

const MAX_HISTORY_TURNS = 6;
const MAX_PROMPT_CHARS = 40_000;

function flattenMessages(options: ChatModelRunOptions): string {
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
  return "…[older turns truncated]…\n\n" + out.slice(-MAX_PROMPT_CHARS);
}

function entryToPart(e: Entry): ThreadAssistantMessagePart {
  if (e.kind === "text") return { type: "text", text: e.text };
  if (e.kind === "reasoning") return { type: "reasoning", text: e.text };
  if (e.kind === "note") return { type: "text", text: e.text };
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
      cli: "claude",
      title: "Claude session",
    });
    console.debug("[persistence] session ensured", sessionId);
  } catch (e) {
    console.warn("[persistence] sessions.create failed", sessionId, e);
  }
}

export const claudeAdapter: ChatModelAdapter = {
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

    // Slash-command interception (same handler set as codex-adapter).
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

    // Plan Mode: prefix with the hardened system prefix when the per-cli toggle
    // is on. Without this, Claude treats the prompt as a normal chat turn —
    // asks clarifying questions, attempts AskUserQuestion (which fails in -p
    // mode), uses emojis, etc. Mirrors codex-adapter.ts.
    const planModeOn = isPlanModeOn("claude");
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
    }

    const order: string[] = [];
    const entries = new Map<string, Entry>();
    let anon = 0;
    const nextAnon = () => `anon-${++anon}`;

    const upsert = (key: string, entry: Entry) => {
      if (!entries.has(key)) order.push(key);
      entries.set(key, entry);
    };
    const removeEntry = (key: string) => {
      if (!entries.has(key)) return;
      entries.delete(key);
      const i = order.indexOf(key);
      if (i !== -1) order.splice(i, 1);
    };

    const buffer: ClaudeEvent[] = [];
    let ended = false;
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

    const { selectedModelByCli, claudeApiKey, claudeContextOverride } = useIDE.getState();
    const claudeModel = selectedModelByCli["claude"];
    const env: Record<string, string> = {};
    if (claudeApiKey) env.ANTHROPIC_API_KEY = claudeApiKey;

    // Claude Code CLI unlocks 1M context by appending `[1m]` to the model id
    // (e.g. `claude-opus-4-7[1m]`). The CLI handles the underlying
    // `anthropic-beta: context-1m-2025-08-07` header internally — we must not
    // inject it ourselves. See https://code.claude.com/docs/en/model-config
    // (Extended context section).
    const oneM = claudeContextOverride === "1m" && supportsOneM("claude", claudeModel);
    const effectiveModel = claudeModel ? `${claudeModel}${oneM ? "[1m]" : ""}` : undefined;

    const effort = getReasoningEffort("claude");
    const modelArgs = claudeExtraArgs(effectiveModel) ?? [];
    // Claude Code CLI v2.1.117+ accepts `--effort low|medium|high|xhigh|max`.
    // The CLI silently falls back when a model doesn't support a level
    // (e.g. xhigh → high on Opus 4.6). Pass the user's selection unchanged.
    // `--include-partial-messages` enables progressive `stream_event` deltas
    // (text_delta / thinking_delta) so the UI streams reasoning + text token-by-
    // token instead of dumping the full block at message end. The `assistant`
    // event still arrives at message-end with the full content as a checkpoint;
    // its handler is idempotent and re-upserts the same keys with the final text.
    const extraArgs = [...modelArgs, "--effort", effort, "--include-partial-messages"];

    const handle = await provider.chatSpawn({
      cli: "claude",
      prompt,
      extraArgs,
      env: Object.keys(env).length ? env : undefined,
    });

    const offEvent = handle.onEvent((evt) => {
      buffer.push(evt as ClaudeEvent);
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
    let assistantMsgCounter = 0;
    // Map an Anthropic message.id → our local msgIdx. Used so that
    // `stream_event` (message_start) and the eventual `assistant` checkpoint
    // event resolve to the SAME key (`msg:N:i` / `think:N:i`) and the latter
    // overwrites the former idempotently instead of duplicating.
    const messageIdToIdx = new Map<string, number>();
    const idxForMessage = (id: string | undefined): number => {
      const key = id ?? "";
      const existing = messageIdToIdx.get(key);
      if (existing !== undefined) return existing;
      const next = ++assistantMsgCounter;
      if (key) messageIdToIdx.set(key, next);
      return next;
    };
    // Track the active message id for stream_event sub-events that don't
    // re-include it (content_block_*, message_delta, message_stop).
    let currentStreamMsgId: string | undefined;
    // Cumulative SSE block offset per msgIdx. Claude CLI emits ONE legacy
    // `assistant` event per content_block (not one per message), each with
    // content=[single_block] — so the local `i` is always 0. We must add the
    // running offset to recover the global SSE block index, otherwise the keys
    // diverge from stream_event (which uses event.index) and we get duplicate
    // text entries. See repro: a message with [thinking, text, tool_use] yielded
    // [think:N:0, msg:N:1 (from stream_event), msg:N:0 (from assistant), tool:id].
    const assistantBlockOffset = new Map<number, number>();

    try {
      while (!ended || buffer.length) {
        if (!buffer.length) {
          await wait();
          continue;
        }
        const evt = buffer.shift()!;
        const type = typeof evt.type === "string" ? evt.type : "";

        if (type === "stream_event") {
          // Anthropic SSE deltas wrapped by Claude CLI when --include-partial-messages
          // is set. Schema:
          //   message_start          → { event:{ message:{id, ...} } }
          //   content_block_start    → { event:{ index, content_block:{type, id?, name?} } }
          //   content_block_delta    → { event:{ index, delta:{type:"text_delta"|"thinking_delta"|"input_json_delta"|"signature_delta", text?, thinking?, partial_json?} } }
          //   content_block_stop     → { event:{ index } }
          //   message_delta / message_stop → terminal markers (ignored)
          const inner = (evt as { event?: Record<string, unknown> }).event ?? {};
          const innerType = typeof inner.type === "string" ? inner.type : "";

          if (innerType === "message_start") {
            const msg = inner.message as { id?: string } | undefined;
            currentStreamMsgId = typeof msg?.id === "string" ? msg.id : undefined;
            // Pre-register the idx so the assistant checkpoint reuses it.
            idxForMessage(currentStreamMsgId);
          } else if (innerType === "content_block_start") {
            const idx = typeof inner.index === "number" ? inner.index : 0;
            const block = inner.content_block as
              | { type?: string; id?: string; name?: string }
              | undefined;
            const btype = typeof block?.type === "string" ? block.type : "";
            const msgIdx = idxForMessage(currentStreamMsgId);
            if (btype === "text") {
              upsert(`msg:${msgIdx}:${idx}`, { kind: "text", text: "" });
            } else if (btype === "thinking") {
              upsert(`think:${msgIdx}:${idx}`, { kind: "reasoning", text: "" });
            } else if (btype === "tool_use") {
              const id = typeof block?.id === "string" ? block.id : nextAnon();
              const name = typeof block?.name === "string" ? block.name : "tool";
              upsert(`tool:${id}`, { kind: "tool", id, name, args: {} });
            }
          } else if (innerType === "content_block_delta") {
            const idx = typeof inner.index === "number" ? inner.index : 0;
            const delta = inner.delta as
              | { type?: string; text?: string; thinking?: string }
              | undefined;
            const dtype = typeof delta?.type === "string" ? delta.type : "";
            const msgIdx = idxForMessage(currentStreamMsgId);
            if (dtype === "text_delta") {
              const key = `msg:${msgIdx}:${idx}`;
              const prev = entries.get(key);
              const prevText = prev && prev.kind === "text" ? prev.text : "";
              const add = typeof delta?.text === "string" ? delta.text : "";
              if (add) upsert(key, { kind: "text", text: prevText + add });
            } else if (dtype === "thinking_delta") {
              const key = `think:${msgIdx}:${idx}`;
              const prev = entries.get(key);
              const prevText = prev && prev.kind === "reasoning" ? prev.text : "";
              const add = typeof delta?.thinking === "string" ? delta.thinking : "";
              if (add) upsert(key, { kind: "reasoning", text: prevText + add });
            }
            // input_json_delta + signature_delta: not streamed to the UI.
            // Tool args/signatures arrive complete in the `assistant` checkpoint,
            // which fires before content_block_stop and overwrites our placeholder.
          }
          // content_block_stop / message_delta / message_stop: nothing to do —
          // the `assistant` and `result` events handle finalization.
        } else if (type === "assistant") {
          // Full message checkpoint — fires once per LLM turn step, AFTER the
          // matching deltas (when --include-partial-messages is on). Idempotent:
          // re-upserts the same keys with the final content. Without partials,
          // this is the only source of message content.
          const content = Array.isArray(evt.message?.content) ? evt.message.content : [];
          const msgId = (evt.message as { id?: string } | undefined)?.id;
          const msgIdx = idxForMessage(msgId);
          // Recover the global SSE block index by adding the cumulative offset
          // of blocks already seen in prior `assistant` events for this msgIdx.
          const offset = assistantBlockOffset.get(msgIdx) ?? 0;

          for (let i = 0; i < content.length; i++) {
            const block = content[i];
            const btype = typeof block?.type === "string" ? block.type : "";
            const globalIdx = offset + i;

            if (btype === "text") {
              const t = typeof block.text === "string" ? block.text : "";
              if (t) {
                // Plan Mode fallback: if Claude returned the hardened markdown
                // plan, promote it to a structured plan tool entry so the UI
                // renders <PlanStepList> instead of a wall of markdown text.
                let promoted = false;
                if (planModeOn) {
                  const parsed = parsePlanMarkdown(t);
                  if (parsed) {
                    const planKey = `plan:msg:${msgIdx}:${globalIdx}`;
                    upsert(planKey, {
                      kind: "tool",
                      id: planKey,
                      name: "plan",
                      args: {
                        title: parsed.title,
                        explanation: parsed.explanation,
                        steps: parsed.steps,
                        followUps: parsed.followUps,
                      } as Record<string, unknown>,
                      result: "ok",
                    });
                    // Drop the raw markdown text entry that stream_event built
                    // up via deltas — otherwise both the markdown wall-of-text
                    // AND the structured PlanStepList render side-by-side, and
                    // both get persisted to BDD (visible after refresh).
                    removeEntry(`msg:${msgIdx}:${globalIdx}`);
                    promoted = true;
                  }
                }
                if (!promoted) upsert(`msg:${msgIdx}:${globalIdx}`, { kind: "text", text: t });
              }
            } else if (btype === "thinking") {
              const t = typeof block.thinking === "string" ? block.thinking : "";
              if (t) upsert(`think:${msgIdx}:${globalIdx}`, { kind: "reasoning", text: t });
            } else if (btype === "tool_use") {
              const id = typeof block.id === "string" ? block.id : nextAnon();
              const name = typeof block.name === "string" ? block.name : "tool";
              const input =
                block.input && typeof block.input === "object"
                  ? (block.input as Record<string, unknown>)
                  : {};
              upsert(`tool:${id}`, {
                kind: "tool",
                id,
                name,
                args: input,
              });
            }
          }
          assistantBlockOffset.set(msgIdx, offset + content.length);
        } else if (type === "user") {
          // Tool results: `{type:"user", message:{content:[{type:"tool_result", tool_use_id, content, is_error?}]}}`.
          const content = Array.isArray(evt.message?.content) ? evt.message.content : [];
          for (const block of content) {
            if (block?.type !== "tool_result") continue;
            const tid = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
            if (!tid) continue;
            const existing = entries.get(`tool:${tid}`);
            if (!existing || existing.kind !== "tool") continue;
            // Content can be string or array of blocks. Flatten to string.
            let resultText = "";
            if (typeof block.content === "string") {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .map((c) => {
                  const cb = c as { type?: string; text?: string };
                  if (cb?.type === "text" && typeof cb.text === "string") return cb.text;
                  return JSON.stringify(c);
                })
                .join("\n");
            } else if (block.content != null) {
              resultText = JSON.stringify(block.content);
            }
            const isError = block.is_error === true;
            upsert(`tool:${tid}`, {
              ...existing,
              result: resultText || "(no output)",
              isError,
            });
          }
        } else if (type === "result") {
          // Terminal event — persist usage for the ContextRing/StatusButton,
          // surface errors when subtype is not "success".
          const subtype = typeof evt.subtype === "string" ? evt.subtype : "";
          const inputTokens =
            typeof evt.usage?.input_tokens === "number" ? evt.usage.input_tokens : 0;
          const outputTokens =
            typeof evt.usage?.output_tokens === "number" ? evt.usage.output_tokens : 0;
          if (inputTokens || outputTokens) {
            try {
              useIDE.getState().setLastUsage("claude", inputTokens, outputTokens);
            } catch (e) {
              console.warn("[claude] setLastUsage failed", e);
            }
          }
          if (subtype !== "success") {
            const msg =
              typeof evt.result === "string" && evt.result
                ? evt.result
                : `Claude run ended with subtype=${subtype || "unknown"}`;
            upsert(nextAnon(), { kind: "note", text: `⚠️ ${msg}` });
          }
        } else if (type === "system") {
          // init / other system events — silent.
          void 0;
        } else if (type === "stderr") {
          const txt = typeof evt.text === "string" ? evt.text : "";
          if (txt.trim()) upsert(nextAnon(), { kind: "note", text: txt.trim() });
        } else if (type === "error" || type === "raw") {
          const msg = typeof evt.text === "string" ? evt.text : JSON.stringify(evt).slice(0, 500);
          upsert(nextAnon(), { kind: "note", text: `⚠️ ${msg}` });
        }

        const rendered = renderParts(order, entries);
        collectedParts.splice(0, collectedParts.length, ...rendered);
        yield { content: rendered };
      }

      if (exitInfo && exitInfo.code !== 0 && order.length === 0) {
        const fallback: ThreadAssistantMessagePart = {
          type: "text",
          text: `claude exited with code=${exitInfo.code} signal=${exitInfo.signal ?? "null"}`,
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
        } catch (e) {
          console.warn("[persistence] messages.append (assistant) failed", sessionId, e);
        }
      }
    }
  },
};
