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
  // 1. Bump the clear-tick in the store → forces ChatView to remount with empty history.
  useIDE.getState().tickClearSession(ctx.workspaceId);

  // 2. Delete persisted messages from the DB (best-effort; keep session row).
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

  toast.success("Conversation cleared");
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
    handler: async (_ctx) => {
      // TODO(IMPL-2): call codex with COMPACT_PROMPT_V1, clear thread, inject summary as seed.
      toast.info("/compact — not yet implemented (see COMPACT_PROMPT_V1 in slash-commands.ts)");
    },
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
