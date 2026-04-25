/**
 * Slash-command executor for the Chat composer.
 *
 * Sourced from Claude Code CLI:
 *   - /clear  → src/commands/clear/conversation.ts:49-251
 *   - /compact → src/services/compact/prompt.ts (BASE_COMPACT_PROMPT)
 *
 * @see https://github.com/anthropics/claude-code (private; audited 2026-04-24)
 */

import { toast } from "sonner";
import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { persistence } from "@/lib/persistence/client";
import type { DbMessage } from "@/lib/persistence/types";
import { codexExtraArgs } from "@/lib/chat/models";
import { useIDE } from "@/store/ide";
import type { WorkspaceSource } from "@/lib/fs";

// ---------------------------------------------------------------------------
// Compact prompt constant
// Sourced from claude-code src/services/compact/prompt.ts — BASE_COMPACT_PROMPT
// ---------------------------------------------------------------------------

export const COMPACT_PROMPT_V1 = `Please provide a comprehensive summary of our conversation in the following 9 sections:

1. **Primary Request and Intent**: What the user wanted, in one concise sentence.
2. **Key Technical Concepts**: The main technologies, frameworks, or algorithms discussed.
3. **Files and Code Sections**: Every file read, created or edited (with paths).
4. **Errors and Fixes**: Problems encountered and how they were resolved.
5. **Decisions and Trade-offs**: Architecture or design choices made and the rationale.
6. **Unresolved Questions**: Open issues or things still to investigate.
7. **Pending Tasks**: Concrete next steps the user still needs to do.
8. **Current Work State**: Exact state of code at the end of the conversation.
9. **Key Patterns and Preferences**: User style rules or codebase conventions observed.

Be thorough but concise. This summary will replace the full conversation history.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlashCtx = {
  /** Active workspace source (for provider construction). */
  workspaceSource: WorkspaceSource | undefined;
  /** Persistence session id. */
  sessionId: string | undefined;
  /** Workspace id (for the clear-tick in the store). */
  workspaceId: string;
  /** Signal to open the help dialog (set from the Composer). */
  onHelp?: () => void;
};

export type SlashCommandDef = {
  id: string;
  label: string;
  description: string;
  aliases?: string[];
  handler: (ctx: SlashCtx) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getProvider(
  workspaceSource: WorkspaceSource | undefined,
): Promise<RemoteAgentProvider | null> {
  if (!workspaceSource || workspaceSource.kind !== "remote-agent") return null;
  try {
    const p = (await providerFor(workspaceSource, workspaceSource.label)) as RemoteAgentProvider;
    await p.connect();
    return p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command catalogue
// ---------------------------------------------------------------------------

const clearHandler: SlashCommandDef["handler"] = async (ctx) => {
  // Order matters: delete DB rows FIRST, bump the tick AFTER. Otherwise the
  // tick triggers useSessionHistory's refetch before delete commits — the
  // refetch wins the race and resurrects the old transcript (hard refresh
  // required to recover). Mirrors the correct order used in compactHandler.
  if (ctx.sessionId && ctx.workspaceSource) {
    const provider = await getProvider(ctx.workspaceSource);
    if (provider) {
      try {
        await persistence.messages.deleteForSession(provider, ctx.sessionId);
      } catch (e) {
        console.warn("[slash /clear] messages.deleteForSession failed:", e);
      }
    }
  }

  useIDE.getState().tickClearSession(ctx.workspaceId);
  toast.success("Conversation cleared");
};

// ---------------------------------------------------------------------------
// /compact — run codex one-shot with COMPACT_PROMPT_V1 against the transcript,
// wipe persisted messages, seed the thread with the summary.
// ---------------------------------------------------------------------------

const COMPACT_TIMEOUT_MS = 120_000;
const COMPACT_TRANSCRIPT_MAX_CHARS = 80_000;

function flattenDbTranscript(rows: DbMessage[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    let parts: Array<{ type: string; text?: string }> = [];
    try {
      parts = JSON.parse(row.parts_json) as Array<{ type: string; text?: string }>;
    } catch {
      continue;
    }
    const text = parts
      .filter((p) => p.type === "text" || p.type === "reasoning")
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
    if (!text.trim()) continue;
    const role = row.role === "user" ? "User" : row.role === "assistant" ? "Assistant" : "System";
    lines.push(`${role}: ${text}`);
  }
  const joined = lines.join("\n\n");
  if (joined.length <= COMPACT_TRANSCRIPT_MAX_CHARS) return joined;
  return `…[older turns truncated]…\n\n${joined.slice(-COMPACT_TRANSCRIPT_MAX_CHARS)}`;
}

async function runCodexOneShot(provider: RemoteAgentProvider, prompt: string): Promise<string> {
  const { codexModel, codexApiKey } = useIDE.getState();
  const env: Record<string, string> = {};
  if (codexApiKey) env.OPENAI_API_KEY = codexApiKey;

  const handle = await provider.chatSpawn({
    cli: "codex",
    prompt,
    extraArgs: codexExtraArgs(codexModel),
    env: Object.keys(env).length ? env : undefined,
  });

  return new Promise<string>((resolve, reject) => {
    // `agent_message` emits the whole text on item.updated AND item.completed
    // (codex re-sends the final text at completion). We keep the last non-empty
    // value — that is the final answer.
    let finalText = "";
    const timer = setTimeout(() => {
      try {
        handle.kill();
      } catch {
        /* ignore */
      }
      cleanup();
      reject(new Error(`compact timed out after ${Math.round(COMPACT_TIMEOUT_MS / 1000)}s`));
    }, COMPACT_TIMEOUT_MS);

    const offEvent = handle.onEvent((evt) => {
      const e = evt as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      const type = e.type;
      const itemType = e.item?.type;
      if ((type === "item.updated" || type === "item.completed") && itemType === "agent_message") {
        const t = typeof e.item?.text === "string" ? e.item.text : "";
        if (t) finalText = t;
      }
    });

    const offEnd = handle.onEnd((code) => {
      cleanup();
      if (!finalText) {
        reject(new Error(`codex produced no summary (exit code=${code ?? "null"})`));
        return;
      }
      resolve(finalText);
    });

    function cleanup() {
      clearTimeout(timer);
      offEvent();
      offEnd();
    }
  });
}

const compactHandler: SlashCommandDef["handler"] = async (ctx) => {
  if (!ctx.sessionId) {
    toast.error("/compact — no active session");
    return;
  }
  const provider = await getProvider(ctx.workspaceSource);
  if (!provider) {
    toast.error("/compact — remote-agent workspace required");
    return;
  }

  let rows: DbMessage[];
  try {
    rows = await persistence.messages.list(provider, ctx.sessionId);
  } catch (e) {
    toast.error(`/compact — failed to read history: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const transcript = flattenDbTranscript(rows);
  if (!transcript.trim()) {
    toast.info("/compact — nothing to compact");
    return;
  }

  const toastId = toast.loading("Compacting conversation…");
  try {
    const prompt = `${COMPACT_PROMPT_V1}\n\n---\n\nConversation transcript:\n\n${transcript}`;
    const summary = await runCodexOneShot(provider, prompt);

    // Replace DB messages with a single assistant seed holding the summary.
    // Mirrors Claude Code's subtype="compact_boundary" JSONL marker.
    await persistence.messages.deleteForSession(provider, ctx.sessionId);
    await persistence.messages.append(provider, {
      sessionId: ctx.sessionId,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `📋 **Conversation summary (compacted)**\n\n${summary.trim()}`,
        },
      ],
    });

    // Remount the thread so useLocalRuntime picks up the fresh initialMessages.
    useIDE.getState().tickClearSession(ctx.workspaceId);
    toast.success("Conversation compacted", { id: toastId });
  } catch (e) {
    toast.error(`/compact failed: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
  }
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    id: "clear",
    label: "/clear",
    description: "Clear the current conversation",
    aliases: ["reset", "new"],
    handler: clearHandler,
  },
  {
    id: "reset",
    label: "/reset",
    description: "Alias for /clear",
    handler: clearHandler,
  },
  {
    id: "new",
    label: "/new",
    description: "Alias for /clear",
    handler: clearHandler,
  },
  {
    id: "compact",
    label: "/compact",
    description: "Compact the conversation history into a summary",
    handler: compactHandler,
  },
  {
    id: "help",
    label: "/help",
    description: "Show available commands",
    handler: async (ctx) => {
      ctx.onHelp?.();
    },
  },
];

// Fast lookup by id (including aliases).
const SLASH_MAP = new Map<string, SlashCommandDef>(SLASH_COMMANDS.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a slash command by id.
 * @returns `true` if the command was handled (i.e. caller should suppress normal send).
 */
export async function executeSlash(id: string, ctx: SlashCtx): Promise<boolean> {
  const def = SLASH_MAP.get(id);
  if (!def) return false;
  try {
    await def.handler(ctx);
  } catch (e) {
    console.error(`[slash /${id}] handler error:`, e);
    toast.error(`/${id} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}

/**
 * Parse a raw prompt string and, if it is a bare slash command, run it.
 * @returns `true` if intercepted.
 */
export async function maybeInterceptSlash(prompt: string, ctx: SlashCtx): Promise<boolean> {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/")) return false;
  // Extract the command id: first word after "/"
  const id = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
  return executeSlash(id, ctx);
}
