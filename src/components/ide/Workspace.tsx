import { useCallback, useEffect, useMemo, useState } from "react";
import { X, FileCode, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useIDE,
  useCurrentActiveTab,
  useCurrentBranches,
  useCurrentOpenFiles,
  useCurrentTasks,
  useCurrentWorktree,
  useActiveAgentThread,
  type AgentTabId,
  type TabId,
  type TerminalKind,
  type WorkspaceTerminal,
  type Worktree,
  type FileTab,
  type AgentThreadView,
  type LargeComposerDraft,
} from "@/store/ide";
import { Thread } from "@/components/assistant-ui/thread";
import { getReasoningEffort } from "@/components/ide/reasoning-pill";
import { AssistantRuntimeProvider } from "@assistant-ui/core/react";
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useExternalStoreRuntime,
  type AttachmentAdapter,
  type AppendMessage,
  type CompleteAttachment,
  type PendingAttachment,
  type ThreadSuggestion,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { CodeEditor } from "@/components/ide/code-editor";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentTaskAttachment, Task, TaskLogEntry } from "@/lib/fs/remote-agent";
import {
  applyPlanModePrompt,
  isPlanModeOn,
  parsePlanMarkdown,
  stripPlanModePrompt,
} from "@/lib/chat/plan-mode";
import { DEFAULT_CLAUDE_MODEL } from "@/lib/chat/models";

const agentFaviconSrc: Record<TerminalKind, string> = {
  codex: "/agents/codex.svg",
  claude: "/agents/claude-code.svg",
  opencode: "/agents/opencode.ico",
  gemini: "/agents/gemini.svg",
};

const staticTabs: { id: AgentTabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Codebase Overview", icon: <span className="text-status-del">✦</span> },
  { id: "audit", label: "Codebase Perf Audit", icon: <span className="text-status-add">⬢</span> },
];

function ProductFavicon({ agent, label }: { agent: TerminalKind; label: string }) {
  return (
    <img
      src={agentFaviconSrc[agent]}
      alt={`${label} favicon`}
      className={cn(
        "h-3.5 w-3.5 shrink-0 object-contain",
        agent === "codex" && "rounded-[4px] bg-white p-[1px]",
      )}
      loading="eager"
      decoding="async"
    />
  );
}

function FileView({
  tabId,
  path,
  content,
  loading,
  isBinary,
  isDirty,
  error,
  preview,
}: {
  tabId: `file:${string}`;
  path: string;
  content: string | null;
  loading?: boolean;
  isBinary?: boolean;
  isDirty?: boolean;
  error?: string;
  preview: boolean;
}) {
  const isMarkdown = path.endsWith(".md");
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-code-bg/40 px-6 py-2 font-mono text-[11.5px] text-muted-foreground">
        <span>{path}</span>
        {isDirty && !loading && content !== null && (
          <span className="text-status-warn" title="Unsaved changes">
            •
          </span>
        )}
        {!isDirty && !loading && content !== null && !isBinary && (
          <span className="text-status-add/70 text-[10px]" title="Saved">
            saved
          </span>
        )}
        {preview && isMarkdown && content !== null && (
          <span className="ml-2 text-primary">· preview</span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2 px-6 py-4">
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        </div>
      ) : isBinary ? (
        <div className="flex h-32 items-center justify-center text-[13px] text-muted-foreground">
          Binary file — preview not available.
        </div>
      ) : content === null ? (
        <div className="flex h-32 items-center justify-center text-[13px] text-status-del">
          {error ?? "Failed to load file."}
        </div>
      ) : preview && isMarkdown ? (
        <div className="scrollbar-visible flex-1 overflow-y-auto">
          <div className="markdown-preview max-w-3xl px-6 py-4 text-[14px] leading-6 text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor tabId={tabId} path={path} content={content} />
        </div>
      )}
    </div>
  );
}

function TerminalView({
  terminal,
  workspaceName,
  branchName,
  worktree,
  taskCount,
}: {
  terminal: WorkspaceTerminal;
  workspaceName: string;
  branchName: string;
  worktree: Worktree;
  taskCount: number;
}) {
  return (
    <div className="scrollbar-visible h-full overflow-y-auto bg-code-bg/30 px-6 py-5 font-mono text-[12.5px] leading-6">
      <div className="text-syntax-comment">
        # {terminal.title} session — workspace: {workspaceName} — branch: {branchName}
      </div>
      <div className="mt-2">
        <span className="text-syntax-string">$</span> {terminal.lastCommand}
      </div>
      <div className="text-syntax-type">→ attaching PTY to {worktree.path}</div>
      <div className="text-syntax-type">→ worktree status: {worktree.status}</div>
      <div className="text-syntax-type">→ task queue: {taskCount} branch-linked task(s)</div>
      <div className="text-foreground">Ready. Type instructions in the composer below.</div>
      <div className="mt-3 text-syntax-comment">
        # context: active worktree "{worktree.name}" derived from the current branch scope
      </div>
      <div className="mt-1">
        <span className="text-syntax-keyword">async fn</span>{" "}
        <span className="text-syntax-fn">main</span>() {"{"}
      </div>
      <div className="pl-4">
        <span className="text-syntax-keyword">let</span> session ={" "}
        <span className="text-syntax-type">WorktreeSession</span>::
        <span className="text-syntax-fn">attach</span>( "{worktree.path}");
      </div>
      <div className="pl-4">
        session.<span className="text-syntax-fn">spawn_agent</span>("{terminal.kind}")?;
      </div>
      <div>{"}"}</div>
    </div>
  );
}

function AuditView({ branchName }: { branchName: string }) {
  const rows = [
    { metric: "Cold start", value: "412 ms", trend: "+3%", warn: false },
    { metric: "Frame time (p99)", value: "8.2 ms", trend: "-12%", warn: false },
    { metric: "Memory (idle)", value: "186 MB", trend: "+1%", warn: false },
    { metric: "Git refresh", value: "94 ms", trend: "+18%", warn: true },
    { metric: "PR poll", value: "1.2 s", trend: "stable", warn: false },
  ];
  return (
    <div className="px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-[22px] font-semibold">Codebase Perf Audit</h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          Latest benchmarks · {branchName} · 14h ago
        </p>
        <div className="mt-5 overflow-hidden rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-code-bg/60 text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Metric</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r, i) => (
                <tr key={r.metric} className={cn(i > 0 && "border-t border-border")}>
                  <td className="px-4 py-2.5 font-sans">{r.metric}</td>
                  <td className="px-4 py-2.5 text-syntax-num">{r.value}</td>
                  <td
                    className={cn("px-4 py-2.5", r.warn ? "text-status-warn" : "text-status-add")}
                  >
                    {r.trend}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OverviewView() {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      <div className="text-[13px] font-medium text-foreground">Codebase overview</div>
      <p className="max-w-md text-[12.5px] text-muted-foreground">
        Chat with the agent below. Open a file from the tree to edit it above the CLI.
      </p>
    </section>
  );
}

const EMPTY_TASKS: Task[] = [];
const EMPTY_TASK_EVENTS: TaskLogEntry[] = [];
const EMPTY_THREAD_SUGGESTIONS: ThreadSuggestion[] = [];
const NEW_TASK_THREAD_SUGGESTIONS: ThreadSuggestion[] = [
  { prompt: "Audit the current workspace and identify the riskiest UX bugs" },
  { prompt: "Explain how tasks and CLI sessions should be structured here" },
];

type ThreadContentArray = Exclude<ThreadMessageLike["content"], string>;
type ThreadContentPart = ThreadContentArray[number];
type ToolCallContentPart = Extract<ThreadContentPart, { type: "tool-call" }>;
type MutableTextContentPart = { type: "text"; text: string };
type MutableReasoningContentPart = { type: "reasoning"; text: string };
type MutableThreadContentPart =
  | MutableTextContentPart
  | MutableReasoningContentPart
  | ToolCallContentPart;

type SpawnAgentDescriptor = {
  toolCallId: string;
  label?: string;
  prompt?: string;
  receiverThreadIds?: unknown;
  status?: "running" | "done" | "failed";
  summary?: string;
};

const LARGE_MESSAGE_DISPLAY_CHARS = 12_000;

function summarizeLargeDraft(draft: LargeComposerDraft): string {
  return summarizeLargePromptText(draft.fullText);
}

function summarizeLargePromptText(text: string): string {
  return `[Large prompt: ${text.length.toLocaleString("en-US")} chars hidden for performance]`;
}

function compactUserPromptForDisplay(text: string): string {
  if (text.length <= LARGE_MESSAGE_DISPLAY_CHARS) return text;
  return summarizeLargePromptText(text);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

class GenericFileAttachmentAdapter implements AttachmentAdapter {
  accept = "*";

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      id: crypto.randomUUID(),
      type: "file",
      name: file.name,
      contentType: file.type || "application/octet-stream",
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const dataUrl = await readFileAsDataUrl(attachment.file);
    const data = dataUrl.replace(/^data:[^;]+;base64,/, "");

    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          data,
          mimeType: attachment.contentType || "application/octet-stream",
        },
      ],
    };
  }

  async remove() {
    // Nothing to clean up: the file is kept only in assistant-ui composer state.
  }
}

const threadAttachmentAdapter = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new SimpleTextAttachmentAdapter(),
  new GenericFileAttachmentAdapter(),
]);

function convertExternalThreadMessage(message: ThreadMessageLike) {
  return message;
}

function textContentPart(text: string): ThreadContentArray {
  return [{ type: "text", text }];
}

function threadMessageText(message: ThreadMessageLike): string {
  return textFromContent(message.content);
}

function appendTextMessage(
  messages: ThreadMessageLike[],
  role: "assistant" | "user",
  text: string,
  id: string,
  createdAt: Date,
) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const displayText = role === "user" ? compactUserPromptForDisplay(trimmed) : trimmed;
  const previous = messages[messages.length - 1];
  if (previous?.role === role && threadMessageText(previous) === displayText) return;
  messages.push({
    id,
    role,
    content: textContentPart(displayText),
    createdAt,
    ...(role === "assistant"
      ? { status: { type: "complete" as const, reason: "stop" as const } }
      : {}),
  });
}

function appendAssistantPartsMessage(
  messages: ThreadMessageLike[],
  parts: MutableThreadContentPart[],
  id: string,
  createdAt: Date,
  running: boolean,
) {
  const normalized = parts.filter((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return part.text.trim().length > 0;
    }
    return true;
  });
  if (normalized.length === 0) return;
  messages.push({
    id,
    role: "assistant",
    content: normalized,
    createdAt,
    status: running ? { type: "running" } : { type: "complete", reason: "stop" },
  });
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") return p.text;
      if (typeof p.content === "string") return p.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function textFromUserContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") return p.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function stringifyToolInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function normalizeToolArgs(input: unknown): NonNullable<ToolCallContentPart["args"]> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as NonNullable<ToolCallContentPart["args"]>;
  }
  if (input === undefined || input === null) {
    return {} as NonNullable<ToolCallContentPart["args"]>;
  }
  const value =
    typeof input === "string" || typeof input === "number" || typeof input === "boolean"
      ? input
      : (stringifyToolInput(input) ?? "");
  return { value };
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferSubagentDisplayName(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined;
  const compact = prompt.replace(/\s+/g, " ").trim();
  const directMatch =
    compact.match(
      /sous-agent\s+([a-z0-9][a-z0-9 _-]{0,40}?)(?:[.:,]|\s+(?:qui|charg[eé]|for|to)\b|$)/i,
    ) ??
    compact.match(/sub-agent\s+([a-z0-9][a-z0-9 _-]{0,40}?)(?:[.:,]|\s+(?:who|for|to)\b|$)/i) ??
    compact.match(/you are the\s+([a-z0-9][a-z0-9 _-]{0,40}?)\s+sub-agent\b/i);
  if (directMatch?.[1]) return titleCaseWords(directMatch[1]);
  return undefined;
}

function summarizeCollabState(item: Record<string, unknown>): string | undefined {
  const agentsStates = item.agents_states;
  if (!agentsStates || typeof agentsStates !== "object") return undefined;
  const entries = Object.entries(agentsStates as Record<string, Record<string, unknown>>);
  if (entries.length === 0) return undefined;
  return entries
    .map(([threadId, state]) => {
      const status = typeof state?.status === "string" ? state.status : "unknown";
      const message =
        typeof state?.message === "string" && state.message.trim() ? state.message : "";
      return `${threadId}: ${status}${message ? ` — ${message}` : ""}`;
    })
    .join("\n");
}

function spawnAgentDescriptorFromPart(part: ToolCallContentPart): SpawnAgentDescriptor {
  const args = (part.args ?? {}) as Record<string, unknown>;
  return {
    toolCallId: part.toolCallId,
    label: typeof args.agentLabel === "string" ? args.agentLabel : undefined,
    prompt: typeof args.prompt === "string" ? args.prompt : undefined,
    receiverThreadIds: args.receiverThreadIds,
    status: part.isError ? "failed" : part.result !== undefined ? "done" : "running",
    summary: typeof part.result === "string" ? part.result : undefined,
  };
}

function summarizeSpawnAgents(agents: SpawnAgentDescriptor[]): string | undefined {
  const summaries = agents
    .map((agent) => agent.summary?.trim())
    .filter((summary): summary is string => Boolean(summary));
  if (summaries.length === 0) return undefined;
  return summaries.join("\n\n");
}

function buildSpawnAgentsGroupPart(
  seed: ToolCallContentPart,
  extraAgents: SpawnAgentDescriptor[] = [],
): ToolCallContentPart {
  const seedAgent = spawnAgentDescriptorFromPart(seed);
  const agents = [seedAgent, ...extraAgents];
  return {
    type: "tool-call",
    toolCallId: `spawn-group:${seed.toolCallId}`,
    toolName: "spawn_agents",
    args: {
      agents,
    },
    argsText: seed.argsText,
    result: summarizeSpawnAgents(agents) ?? seed.result,
    isError: seed.isError,
  };
}

function argsTextForTool(toolName: string, input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const command = (input as Record<string, unknown>).command;
    if (typeof command === "string" && command.trim()) return command;
  }
  if (toolName.toLowerCase() === "bash" || toolName.toLowerCase() === "shell") {
    return stringifyToolInput(input);
  }
  return undefined;
}

function textFromToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (content === undefined || content === null) return "";
    return stringifyToolInput(content) ?? "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") return p.text;
      if (typeof p.content === "string") return p.content;
      return stringifyToolInput(p) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function attachmentsFromEvent(raw: unknown): CompleteAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index): CompleteAttachment | null => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const name = typeof value.name === "string" && value.name.trim() ? value.name : "attachment";
      const contentType =
        typeof value.contentType === "string" && value.contentType.trim()
          ? value.contentType
          : "application/octet-stream";
      const kind = typeof value.kind === "string" && value.kind.trim() ? value.kind : "file";
      const data = typeof value.data === "string" && value.data.trim() ? value.data : "";
      const isImage = kind === "image" || contentType.toLowerCase().startsWith("image/");
      return {
        id: `event-attachment-${index}-${name}`,
        type: kind === "image" || kind === "document" ? kind : "file",
        name,
        contentType,
        status: { type: "complete" },
        content:
          isImage && data
            ? [{ type: "image", image: `data:${contentType};base64,${data}` }]
            : [
                {
                  type: "data",
                  name: "local-file",
                  data: {
                    path: typeof value.path === "string" ? value.path : undefined,
                    bytes: typeof value.bytes === "number" ? value.bytes : undefined,
                  },
                },
              ],
      };
    })
    .filter((attachment): attachment is CompleteAttachment => Boolean(attachment));
}

function extractUserMessage(event: unknown): { text: string; attachments: CompleteAttachment[] } {
  if (!event || typeof event !== "object") return { text: "", attachments: [] };
  const data = event as Record<string, unknown>;
  const type = data.type as string | undefined;

  if (type === "user_message" && typeof data.text === "string") {
    return { text: data.text, attachments: attachmentsFromEvent(data.attachments) };
  }
  if (type === "user") {
    const message = data.message as Record<string, unknown> | undefined;
    return { text: textFromUserContent(message?.content), attachments: [] };
  }
  return { text: "", attachments: [] };
}

function extractAssistantText(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const data = event as Record<string, unknown>;
  const type = data.type as string | undefined;

  if ((type === "assistant_message" || type === "agent_message") && typeof data.text === "string") {
    return data.text;
  }
  if (type === "assistant") {
    const message = data.message as Record<string, unknown> | undefined;
    return textFromContent(message?.content);
  }
  if (type === "message" && data.role === "assistant" && typeof data.content === "string") {
    return data.content;
  }
  if (type === "text") {
    const part = data.part as Record<string, unknown> | undefined;
    if (typeof part?.text === "string") return part.text;
    if (typeof data.text === "string") return data.text;
  }
  if (type === "item.completed") {
    const item = data.item as Record<string, unknown> | undefined;
    if (
      (item?.type === "assistant_message" || item?.type === "agent_message") &&
      typeof item.text === "string"
    ) {
      return item.text;
    }
    if (item?.type === "command_execution" && typeof item.aggregated_output === "string") {
      const command = typeof item.command === "string" ? `$ ${item.command}\n` : "";
      return `\`\`\`text\n${command}${item.aggregated_output}\n\`\`\``;
    }
  }
  if (type === "stderr" && typeof data.text === "string") return `stderr:\n${data.text}`;
  if (type === "error") {
    const message = typeof data.message === "string" ? data.message : "Unknown agent error";
    return `Error: ${message}`;
  }
  return "";
}

function completedAgentMessage(event: unknown): { id: string | null; text: string } | null {
  if (!event || typeof event !== "object") return null;
  const data = event as Record<string, unknown>;
  if (data.type !== "item.completed") return null;
  const item = data.item as Record<string, unknown> | undefined;
  if (item?.type !== "assistant_message" && item?.type !== "agent_message") return null;
  if (typeof item.text !== "string" || !item.text.trim()) return null;
  return { id: typeof item.id === "string" ? item.id : null, text: item.text };
}

function interimAgentMessageIndexes(events: TaskLogEntry[]): Set<number> {
  const turnIndexByEvent = new Map<number, number>();
  const lastAgentMessageIndexByTurn = new Map<number, number>();
  let turn = -1;

  events.forEach((entry, index) => {
    const data = entry.data as Record<string, unknown> | undefined;
    if (data?.type === "turn.started") turn += 1;
    const turnKey = turn >= 0 ? turn : 0;
    turnIndexByEvent.set(index, turnKey);
    if (completedAgentMessage(entry.data)) {
      lastAgentMessageIndexByTurn.set(turnKey, index);
    }
  });

  const interim = new Set<number>();
  events.forEach((entry, index) => {
    if (!completedAgentMessage(entry.data)) return;
    const turnKey = turnIndexByEvent.get(index) ?? 0;
    const lastIndex = lastAgentMessageIndexByTurn.get(turnKey);
    if (lastIndex !== undefined && index < lastIndex) interim.add(index);
  });
  return interim;
}

function isFinalAssistantText(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const type = (event as Record<string, unknown>).type as string | undefined;
  return (
    type === "assistant_message" ||
    type === "agent_message" ||
    type === "assistant" ||
    type === "message" ||
    type === "item.completed"
  );
}

function extractReasoningText(event: unknown): { id: string | null; text: string; final: boolean } {
  if (!event || typeof event !== "object") return { id: null, text: "", final: false };
  const data = event as Record<string, unknown>;
  const type = data.type as string | undefined;

  if (type === "reasoning" && typeof data.text === "string") {
    const id =
      typeof data.item_id === "string"
        ? data.item_id
        : typeof data.id === "string"
          ? data.id
          : null;
    return { id, text: data.text, final: false };
  }

  if (type === "thinking" && typeof data.text === "string") {
    return { id: typeof data.id === "string" ? data.id : null, text: data.text, final: false };
  }

  if (type === "assistant") {
    const message = data.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const p = part as Record<string, unknown>;
          if (p.type === "thinking" && typeof p.thinking === "string") return p.thinking;
          if (p.type === "reasoning" && typeof p.text === "string") return p.text;
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (text)
        return { id: typeof message?.id === "string" ? message.id : null, text, final: true };
    }
  }

  if (type === "item.completed") {
    const item = data.item as Record<string, unknown> | undefined;
    if (item?.type === "reasoning" && typeof item.text === "string") {
      return {
        id: typeof item.id === "string" ? item.id : null,
        text: item.text,
        final: true,
      };
    }
  }

  // Claude `--include-partial-messages` emits `stream_event` items with
  // content_block_delta of type "thinking_delta" — stream reasoning live.
  if (type === "stream_event") {
    const event_ = data.event as Record<string, unknown> | undefined;
    const evtType = event_?.type as string | undefined;
    if (evtType === "content_block_delta") {
      const delta = event_?.delta as Record<string, unknown> | undefined;
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        const idx = event_?.index;
        const id = typeof idx === "number" ? `claude-thinking-${idx}` : null;
        return { id, text: delta.thinking, final: false };
      }
    }
  }

  return { id: null, text: "", final: false };
}

function extractStartedReasoningId(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const data = event as Record<string, unknown>;
  if (data.type === "item.started") {
    const item = data.item as Record<string, unknown> | undefined;
    if (item?.type !== "reasoning") return null;
    return typeof item.id === "string" ? item.id : null;
  }
  // Claude partial-messages: a thinking content block starts.
  if (data.type === "stream_event") {
    const event_ = data.event as Record<string, unknown> | undefined;
    if (event_?.type === "content_block_start") {
      const block = event_.content_block as Record<string, unknown> | undefined;
      if (block?.type === "thinking") {
        const idx = event_.index;
        return typeof idx === "number" ? `claude-thinking-${idx}` : null;
      }
    }
  }
  return null;
}

function extractToolCallPart(event: unknown, fallbackId: string): ToolCallContentPart | null {
  if (!event || typeof event !== "object") return null;
  const data = event as Record<string, unknown>;
  if (data.type !== "item.completed" && data.type !== "item.started") return null;
  const item = data.item as Record<string, unknown> | undefined;
  if (!item) return null;
  const itemType = item.type as string | undefined;
  const id = typeof item.id === "string" ? item.id : fallbackId;

  if (itemType === "command_execution") {
    const command = typeof item.command === "string" ? item.command : "";
    const output =
      data.type === "item.completed" && typeof item.aggregated_output === "string"
        ? item.aggregated_output
        : undefined;
    const exitCode =
      data.type === "item.completed" && typeof item.exit_code === "number"
        ? item.exit_code
        : undefined;

    return {
      type: "tool-call",
      toolCallId: id,
      toolName: "shell",
      args: command ? { command } : {},
      argsText: command,
      result: output,
      isError: exitCode !== undefined ? exitCode !== 0 : false,
    };
  }

  if (itemType === "collab_tool_call") {
    const toolName = typeof item.tool === "string" && item.tool.trim() ? item.tool : "collab";
    const prompt = typeof item.prompt === "string" ? item.prompt : undefined;
    const agentLabel = inferSubagentDisplayName(prompt);
    return {
      type: "tool-call",
      toolCallId: id,
      toolName,
      args: normalizeToolArgs({
        agentLabel,
        prompt,
        receiverThreadIds: item.receiver_thread_ids,
      }),
      argsText: prompt,
      result: data.type === "item.completed" ? summarizeCollabState(item) : undefined,
      isError: item.status === "failed",
    };
  }

  return null;
}

function extractClaudeToolCallParts(event: unknown, fallbackId: string): ToolCallContentPart[] {
  if (!event || typeof event !== "object") return [];
  const data = event as Record<string, unknown>;

  if (data.type === "assistant") {
    const message = data.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return [];
    return content
      .map((part, index): ToolCallContentPart | null => {
        if (!part || typeof part !== "object") return null;
        const p = part as Record<string, unknown>;
        if (p.type !== "tool_use") return null;
        const toolName = typeof p.name === "string" && p.name.trim() ? p.name : "tool";
        const id = typeof p.id === "string" && p.id.trim() ? p.id : `${fallbackId}-${index}`;
        const input = normalizeToolArgs(p.input);
        return {
          type: "tool-call",
          toolCallId: id,
          toolName,
          args: input,
          argsText: argsTextForTool(toolName, input),
          result: undefined,
          isError: false,
        };
      })
      .filter((part): part is ToolCallContentPart => Boolean(part));
  }

  if (data.type === "stream_event") {
    const event_ = data.event as Record<string, unknown> | undefined;
    if (event_?.type !== "content_block_start") return [];
    const block = event_.content_block as Record<string, unknown> | undefined;
    if (block?.type !== "tool_use") return [];
    const toolName = typeof block.name === "string" && block.name.trim() ? block.name : "tool";
    const id = typeof block.id === "string" && block.id.trim() ? block.id : fallbackId;
    const input = normalizeToolArgs(block.input);
    return [
      {
        type: "tool-call",
        toolCallId: id,
        toolName,
        args: input,
        argsText: argsTextForTool(toolName, input),
        result: undefined,
        isError: false,
      },
    ];
  }

  return [];
}

function extractClaudeToolInputDelta(
  event: unknown,
): { streamIndex: number; partialJson: string } | null {
  if (!event || typeof event !== "object") return null;
  const data = event as Record<string, unknown>;
  if (data.type !== "stream_event") return null;
  const event_ = data.event as Record<string, unknown> | undefined;
  if (event_?.type !== "content_block_delta") return null;
  const delta = event_.delta as Record<string, unknown> | undefined;
  if (delta?.type !== "input_json_delta" || typeof delta.partial_json !== "string") return null;
  return {
    streamIndex: typeof event_.index === "number" ? event_.index : -1,
    partialJson: delta.partial_json,
  };
}

function extractClaudeToolResults(
  event: unknown,
): { toolCallId: string; result: string; isError: boolean }[] {
  if (!event || typeof event !== "object") return [];
  const data = event as Record<string, unknown>;
  if (data.type !== "user") return [];

  const message = data.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return [];

  const toolUseResult = data.tool_use_result as Record<string, unknown> | undefined;
  const stdout = typeof toolUseResult?.stdout === "string" ? toolUseResult.stdout : "";
  const stderr = typeof toolUseResult?.stderr === "string" ? toolUseResult.stderr : "";
  const structuredResult = [stdout.trim(), stderr.trim() ? `stderr:\n${stderr.trim()}` : ""]
    .filter(Boolean)
    .join("\n");

  return content
    .map((part): { toolCallId: string; result: string; isError: boolean } | null => {
      if (!part || typeof part !== "object") return null;
      const p = part as Record<string, unknown>;
      if (p.type !== "tool_result") return null;
      const toolCallId = typeof p.tool_use_id === "string" ? p.tool_use_id : "";
      if (!toolCallId) return null;
      return {
        toolCallId,
        result: structuredResult || textFromToolResultContent(p.content),
        isError:
          p.is_error === true ||
          toolUseResult?.interrupted === true ||
          toolUseResult?.is_error === true,
      };
    })
    .filter((result): result is { toolCallId: string; result: string; isError: boolean } =>
      Boolean(result),
    );
}

function planMarkdownToToolCallPart(text: string, fallbackId: string): ToolCallContentPart | null {
  const plan = parsePlanMarkdown(text);
  if (!plan) return null;
  return {
    type: "tool-call",
    toolCallId: fallbackId,
    toolName: "plan",
    args: plan,
    argsText: text,
    result: undefined,
    isError: false,
  };
}

function buildTaskThreadMessages(
  task: Task,
  events: TaskLogEntry[],
  initialUserMessage?: ThreadMessageLike,
): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = [];
  if (initialUserMessage) {
    messages.push(initialUserMessage);
  } else {
    const visibleRootPrompt = stripPlanModePrompt(task.prompt);
    messages.push({
      id: `${task.id}:user:root`,
      role: "user",
      content: textContentPart(compactUserPromptForDisplay(visibleRootPrompt)),
      createdAt: new Date(task.createdAt),
      metadata: {
        custom: {
          agentPrompt: task.prompt,
          displayPrompt: compactUserPromptForDisplay(visibleRootPrompt),
        },
      },
    });
  }

  let assistantParts: MutableThreadContentPart[] = [];
  let assistantStartedAt: number | null = null;
  let skippedInitialUser = false;
  let currentReasoningId: string | null = null;
  const reasoningPartIndexById = new Map<string, number>();
  const toolPartIndexById = new Map<string, number>();
  const claudeToolStreamByIndex = new Map<number, { toolCallId: string; inputJson: string }>();
  const interimReasoningIndexes = interimAgentMessageIndexes(events);
  const isRunning =
    task.status === "running" || task.status === "queued" || task.status === "awaiting";

  const flushAssistant = (ts: number, running = false) => {
    appendAssistantPartsMessage(
      messages,
      assistantParts,
      `${task.id}:assistant:${messages.length}`,
      new Date(assistantStartedAt ?? ts),
      running,
    );
    assistantParts = [];
    assistantStartedAt = null;
    currentReasoningId = null;
    reasoningPartIndexById.clear();
    toolPartIndexById.clear();
    claudeToolStreamByIndex.clear();
  };

  const appendTextPart = (text: string, ts: number, final = false) => {
    if (!text.trim()) return;
    if (assistantStartedAt === null) assistantStartedAt = ts;
    if (final) {
      const planPart = planMarkdownToToolCallPart(text, `plan-${task.id}-${ts}`);
      if (planPart) {
        const last = assistantParts[assistantParts.length - 1];
        if (last?.type === "text") assistantParts.pop();
        if (!assistantParts.some((part) => part.type === "tool-call" && part.toolName === "plan")) {
          assistantParts.push(planPart);
        }
        return;
      }
    }
    const last = assistantParts[assistantParts.length - 1];
    if (last?.type === "text") {
      if (last.text.trim() === text.trim()) return;
      if (final) {
        last.text = text;
      } else {
        last.text += text;
      }
      return;
    }
    if (assistantParts.some((part) => part.type === "text" && part.text.trim() === text.trim())) {
      return;
    }
    assistantParts.push({ type: "text", text });
  };

  const appendReasoningPart = (id: string | null, text: string, ts: number, final: boolean) => {
    if (!text.trim() && !id) return;
    if (assistantStartedAt === null) assistantStartedAt = ts;

    const effectiveId = id ?? currentReasoningId;
    const knownIndex = effectiveId ? reasoningPartIndexById.get(effectiveId) : undefined;
    if (knownIndex !== undefined) {
      const part = assistantParts[knownIndex];
      if (part?.type === "reasoning") {
        part.text = final ? text : part.text + text;
        return;
      }
    }

    const lastIndex = assistantParts.length - 1;
    const last = assistantParts[lastIndex];
    if (last?.type === "reasoning") {
      last.text = final ? text : last.text + text;
      if (effectiveId) reasoningPartIndexById.set(effectiveId, lastIndex);
      return;
    }

    assistantParts.push({ type: "reasoning", text });
    if (effectiveId) reasoningPartIndexById.set(effectiveId, assistantParts.length - 1);
  };

  const appendOrUpdateToolCallPart = (part: ToolCallContentPart, ts: number) => {
    if (!part.toolCallId) return;
    if (assistantStartedAt === null) assistantStartedAt = ts;
    const toolCallId = part.toolCallId;
    const existingIndex = toolPartIndexById.get(toolCallId);
    if (existingIndex !== undefined) {
      const existing = assistantParts[existingIndex];
      if (existing?.type === "tool-call") {
        if (existing.toolName === "spawn_agents" && part.toolName === "spawn_agent") {
          const existingArgs = (existing.args ?? {}) as Record<string, unknown>;
          const existingAgents = Array.isArray(existingArgs.agents)
            ? [...(existingArgs.agents as SpawnAgentDescriptor[])]
            : [];
          const updatedAgent = spawnAgentDescriptorFromPart(part);
          const agentIndex = existingAgents.findIndex((agent) => agent.toolCallId === toolCallId);
          if (agentIndex >= 0) existingAgents[agentIndex] = updatedAgent;
          else existingAgents.push(updatedAgent);
          assistantParts[existingIndex] = {
            ...existing,
            args: { ...existingArgs, agents: existingAgents },
            result: summarizeSpawnAgents(existingAgents) ?? existing.result,
            isError: existing.isError || part.isError,
          };
          return;
        }
        assistantParts[existingIndex] = {
          ...existing,
          ...part,
          result: existing.result ?? part.result,
          isError: existing.isError || part.isError,
        };
        return;
      }
    }
    if (part.toolName === "spawn_agent") {
      const lastIndex = assistantParts.length - 1;
      const last = assistantParts[lastIndex];
      if (last?.type === "tool-call" && last.toolName === "spawn_agents") {
        const lastArgs = (last.args ?? {}) as Record<string, unknown>;
        const lastAgents = Array.isArray(lastArgs.agents)
          ? [...(lastArgs.agents as SpawnAgentDescriptor[])]
          : [];
        lastAgents.push(spawnAgentDescriptorFromPart(part));
        assistantParts[lastIndex] = {
          ...last,
          args: { ...lastArgs, agents: lastAgents },
          result: summarizeSpawnAgents(lastAgents) ?? last.result,
          isError: last.isError || part.isError,
        };
        toolPartIndexById.set(toolCallId, lastIndex);
        return;
      }
      const groupedPart = buildSpawnAgentsGroupPart(part);
      assistantParts.push(groupedPart);
      const groupedIndex = assistantParts.length - 1;
      toolPartIndexById.set(toolCallId, groupedIndex);
      return;
    }
    assistantParts.push(part);
    toolPartIndexById.set(toolCallId, assistantParts.length - 1);
  };

  const patchToolCallResult = (
    toolCallId: string,
    result: string,
    isError: boolean,
    ts: number,
  ) => {
    if (assistantStartedAt === null) assistantStartedAt = ts;
    const existingIndex = toolPartIndexById.get(toolCallId);
    if (existingIndex === undefined) return;
    const existing = assistantParts[existingIndex];
    if (existing?.type !== "tool-call") return;
    assistantParts[existingIndex] = {
      ...existing,
      result,
      isError,
    };
  };

  const updateClaudeToolInput = (streamIndex: number, partialJson: string) => {
    const state = claudeToolStreamByIndex.get(streamIndex);
    if (!state) return;
    state.inputJson += partialJson;
    const partIndex = toolPartIndexById.get(state.toolCallId);
    if (partIndex === undefined) return;
    const existing = assistantParts[partIndex];
    if (existing?.type !== "tool-call") return;

    let args = existing.args;
    if (state.inputJson.trim()) {
      try {
        args = JSON.parse(state.inputJson);
      } catch {
        args = existing.args;
      }
    }

    assistantParts[partIndex] = {
      ...existing,
      args,
      argsText: argsTextForTool(existing.toolName, args),
    };
  };

  for (const [eventIndex, entry] of events.entries()) {
    const startedReasoningId = extractStartedReasoningId(entry.data);
    if (startedReasoningId) {
      currentReasoningId = startedReasoningId;
      continue;
    }

    const claudeToolCallParts = extractClaudeToolCallParts(
      entry.data,
      `claude-tool-${task.id}-${entry.ts}`,
    );
    if (claudeToolCallParts.length > 0) {
      for (const part of claudeToolCallParts) {
        appendOrUpdateToolCallPart(part, entry.ts);
      }
      const data = entry.data as Record<string, unknown>;
      const streamEvent = data.event as Record<string, unknown> | undefined;
      const streamIndex = typeof streamEvent?.index === "number" ? streamEvent.index : null;
      const firstToolCallId = claudeToolCallParts[0]?.toolCallId;
      if (data.type === "stream_event" && streamIndex !== null && firstToolCallId) {
        claudeToolStreamByIndex.set(streamIndex, {
          toolCallId: firstToolCallId,
          inputJson: "",
        });
        continue;
      }
    }

    const claudeToolInputDelta = extractClaudeToolInputDelta(entry.data);
    if (claudeToolInputDelta) {
      updateClaudeToolInput(claudeToolInputDelta.streamIndex, claudeToolInputDelta.partialJson);
      continue;
    }

    const claudeToolResults = extractClaudeToolResults(entry.data);
    if (claudeToolResults.length > 0) {
      for (const toolResult of claudeToolResults) {
        patchToolCallResult(toolResult.toolCallId, toolResult.result, toolResult.isError, entry.ts);
      }
      continue;
    }

    const userMessage = extractUserMessage(entry.data);
    const userText = userMessage.text;
    if (userText) {
      const visibleUserText = stripPlanModePrompt(userText);
      const displayUserText = compactUserPromptForDisplay(visibleUserText);
      if (
        !skippedInitialUser &&
        visibleUserText.trim() === stripPlanModePrompt(task.prompt).trim()
      ) {
        if (userMessage.attachments.length > 0) {
          const rootMessage = messages[0];
          if (rootMessage?.role === "user" && !rootMessage.attachments?.length) {
            messages[0] = { ...rootMessage, attachments: userMessage.attachments };
          }
        }
        skippedInitialUser = true;
      } else {
        flushAssistant(entry.ts);
        messages.push({
          id: `${task.id}:user:${entry.ts}`,
          role: "user",
          content: textContentPart(displayUserText),
          attachments: userMessage.attachments,
          createdAt: new Date(entry.ts),
          metadata: { custom: { agentPrompt: userText, displayPrompt: displayUserText } },
        });
      }
      continue;
    }

    const reasoning = extractReasoningText(entry.data);
    if (reasoning.text) {
      appendReasoningPart(reasoning.id, reasoning.text, entry.ts, reasoning.final);
      if (reasoning.final && reasoning.id === currentReasoningId) currentReasoningId = null;
      continue;
    }

    if (interimReasoningIndexes.has(eventIndex)) {
      const agentMessage = completedAgentMessage(entry.data);
      if (agentMessage) {
        appendReasoningPart(agentMessage.id, agentMessage.text, entry.ts, true);
        continue;
      }
    }

    const toolCallPart = extractToolCallPart(entry.data, `command-${task.id}-${entry.ts}`);
    if (toolCallPart) {
      appendOrUpdateToolCallPart(toolCallPart, entry.ts);
      continue;
    }

    const assistantText = extractAssistantText(entry.data);
    if (!assistantText) continue;
    appendTextPart(assistantText, entry.ts, isFinalAssistantText(entry.data));
  }

  flushAssistant(Date.now(), isRunning);
  return messages;
}

function threadMessageDedupeKey(message: ThreadMessageLike): string {
  const prompt = submittedPrompt(message);
  if (prompt) return `${message.role}:prompt:${prompt}`;
  if (message.id) return `${message.role}:id:${message.id}`;
  return `${message.role}:text:${threadMessageText(message)}`;
}

function buildAgentThreadMessages(
  thread: AgentThreadView,
  eventsByTaskId: Record<string, TaskLogEntry[]>,
  optimisticMessages: ThreadMessageLike[],
): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = [];
  const seen = new Set<string>();
  for (const task of thread.tasks) {
    const initialUserMessage = optimisticMessages.find(
      (message) => submittedPrompt(message) === task.prompt,
    );
    const taskMessages = buildTaskThreadMessages(
      task,
      eventsByTaskId[task.id] ?? EMPTY_TASK_EVENTS,
      initialUserMessage,
    );
    for (const message of taskMessages) {
      const key = threadMessageDedupeKey(message);
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push(message);
    }
  }
  for (const optimisticMessage of optimisticMessages) {
    const key = threadMessageDedupeKey(optimisticMessage);
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push(optimisticMessage);
  }
  return messages;
}

function appendMessageText(message: AppendMessage): string {
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      return "";
    })
    .join("")
    .trim();
}

function attachmentTextContent(attachment: CompleteAttachment): string {
  return attachment.content
    .map((part) => {
      if (part.type === "text") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function attachmentPromptSummary(attachment: CompleteAttachment): string {
  const text = attachmentTextContent(attachment);
  if (text) return text;
  return "";
}

function messageAttachmentParts(message: AppendMessage): CompleteAttachment[] {
  if ((message.attachments ?? []).length > 0) return [...(message.attachments ?? [])];

  return message.content
    .map((part, index): CompleteAttachment | null => {
      if (!part || typeof part !== "object") return null;
      const value = part as Record<string, unknown>;
      if (value.type === "image" && typeof value.image === "string") {
        const parsed = splitDataUrl(value.image);
        const ext = parsed?.contentType?.split("/")[1]?.replace(/[^A-Za-z0-9]/g, "") || "png";
        return {
          id: `content-image-${index}`,
          type: "image",
          name:
            typeof value.filename === "string" && value.filename.trim()
              ? value.filename
              : `image-${index + 1}.${ext}`,
          contentType: parsed?.contentType ?? "image/*",
          status: { type: "complete" },
          content: [part as CompleteAttachment["content"][number]],
        };
      }
      if (value.type === "file" && typeof value.data === "string") {
        return {
          id: `content-file-${index}`,
          type: "file",
          name:
            typeof value.filename === "string" && value.filename.trim()
              ? value.filename
              : `file-${index + 1}`,
          contentType:
            typeof value.mimeType === "string" && value.mimeType.trim()
              ? value.mimeType
              : "application/octet-stream",
          status: { type: "complete" },
          content: [part as CompleteAttachment["content"][number]],
        };
      }
      return null;
    })
    .filter((attachment): attachment is CompleteAttachment => Boolean(attachment));
}

function appendMessagePrompt(message: AppendMessage): string {
  const text = appendMessageText(message);
  const attachments = messageAttachmentParts(message);
  const attachmentText = attachments.map(attachmentPromptSummary).filter(Boolean).join("\n\n");

  const prompt = [text, attachmentText].filter(Boolean).join("\n\n").trim();
  if (prompt) return prompt;
  if (attachments.length > 0) return "Please inspect the attached file(s).";
  return "";
}

function appendMessageContent(message: AppendMessage): ThreadMessageLike["content"] {
  return message.content.length > 0 ? message.content : [];
}

function appendMessageDisplayContent(message: AppendMessage): ThreadMessageLike["content"] {
  const text = appendMessageText(message);
  if (text.length <= LARGE_MESSAGE_DISPLAY_CHARS) return appendMessageContent(message);
  return textContentPart(compactUserPromptForDisplay(text));
}

function messagePromptFromLargeDraft(
  message: AppendMessage,
  largeDraft: LargeComposerDraft | undefined,
): string {
  const visibleText = appendMessageText(message);
  if (largeDraft && visibleText === largeDraft.previewText) return largeDraft.fullText;
  return appendMessagePrompt(message);
}

function splitDataUrl(value: string): { data: string; contentType?: string } | null {
  const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(value);
  if (!match) return null;
  return {
    contentType: match[1] || undefined,
    data: match[2] ?? "",
  };
}

function attachmentPayload(attachment: CompleteAttachment): AgentTaskAttachment | null {
  for (const part of attachment.content) {
    if (!part || typeof part !== "object") continue;
    const value = part as Record<string, unknown>;
    if (value.type === "image" && typeof value.image === "string") {
      const parsed = splitDataUrl(value.image);
      if (!parsed?.data) continue;
      return {
        name: attachment.name,
        contentType: parsed.contentType ?? attachment.contentType ?? "image/*",
        kind: "image",
        data: parsed.data,
      };
    }
    if (value.type === "file" && typeof value.data === "string") {
      return {
        name:
          typeof value.filename === "string" && value.filename.trim()
            ? value.filename
            : attachment.name,
        contentType:
          typeof value.mimeType === "string" && value.mimeType.trim()
            ? value.mimeType
            : (attachment.contentType ?? "application/octet-stream"),
        kind: attachment.type === "document" ? "document" : "file",
        data: value.data,
      };
    }
  }
  return null;
}

function submittedPrompt(message: ThreadMessageLike): string | undefined {
  const prompt = message.metadata?.custom?.agentPrompt;
  return typeof prompt === "string" ? prompt : undefined;
}

function requestedModelForCli(
  state: ReturnType<typeof useIDE.getState>,
  cli: TerminalKind,
): string | undefined {
  if (cli === "codex") return state.codexModel ?? undefined;
  if (cli === "claude") return state.selectedModelByCli[cli] ?? DEFAULT_CLAUDE_MODEL;
  return state.selectedModelByCli[cli];
}

function AgentThreadHeaderSkeleton() {
  return (
    <div
      className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 bg-background/60 px-4 py-2"
      aria-hidden="true"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-3.5 w-3.5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        <div className="hidden h-3 w-24 animate-pulse rounded bg-muted/70 md:block" />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-5 w-14 animate-pulse rounded bg-muted/70" />
        <div className="h-5 w-16 animate-pulse rounded bg-muted/60" />
        <div className="hidden h-5 w-28 animate-pulse rounded bg-muted/50 lg:block" />
      </div>
    </div>
  );
}

function AgentThreadHydrationSkeleton() {
  return (
    <div
      className="flex h-full flex-col bg-background text-sm"
      role="status"
      aria-label="Loading agent thread"
    >
      <div className="scrollbar-visible flex flex-1 flex-col overflow-hidden px-4 pt-4">
        <div className="mx-auto flex w-full max-w-[48rem] flex-1 flex-col gap-6">
          <div className="ml-auto grid w-full max-w-[34rem] grid-cols-[1fr_auto] gap-y-2 px-2 py-3">
            <div className="col-start-2 space-y-2 rounded-3xl bg-muted px-4 py-3">
              <div className="h-3 w-72 animate-pulse rounded bg-muted-foreground/15" />
              <div className="h-3 w-48 animate-pulse rounded bg-muted-foreground/10" />
            </div>
          </div>

          <div className="space-y-3 px-2">
            <div className="h-28 rounded-2xl border border-border/80 bg-card/45 p-4">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-11/12 animate-pulse rounded bg-muted/80" />
                <div className="h-3 w-9/12 animate-pulse rounded bg-muted/70" />
                <div className="h-3 w-7/12 animate-pulse rounded bg-muted/60" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-3 w-10/12 animate-pulse rounded bg-muted/70" />
              <div className="h-3 w-8/12 animate-pulse rounded bg-muted/60" />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-[48rem] flex-col gap-4 rounded-t-3xl bg-background pb-4">
          <div className="rounded-3xl border border-input bg-background px-4 py-4">
            <div className="h-4 w-72 animate-pulse rounded bg-muted/70" />
            <div className="mt-7 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                <div className="h-8 w-36 animate-pulse rounded-full bg-muted/70" />
                <div className="h-8 w-24 animate-pulse rounded-full bg-muted/60" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-28 animate-pulse rounded-full bg-muted/70" />
                <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
          </div>
          <span className="sr-only">Loading agent thread from URL</span>
        </div>
      </div>
    </div>
  );
}

function AgentThreadHeader({
  hydratingThreadFromUrl = false,
}: {
  hydratingThreadFromUrl?: boolean;
}) {
  const thread = useActiveAgentThread();
  const workspace = useIDE((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const selectedModelByCli = useIDE((s) => s.selectedModelByCli);
  const codexModel = useIDE((s) => s.codexModel);
  const loadTaskDiffStat = useIDE((s) => s.loadTaskDiffStat);
  const diffStat = useIDE((s) =>
    thread?.rootTaskId ? (s.taskDiffStatById[thread.rootTaskId]?.value ?? null) : null,
  );

  useEffect(() => {
    if (thread?.rootTaskId && thread.worktreePath) {
      void loadTaskDiffStat(thread.rootTaskId);
    }
  }, [thread?.rootTaskId, thread?.worktreePath, loadTaskDiffStat]);

  if (hydratingThreadFromUrl && !thread) {
    return <AgentThreadHeaderSkeleton />;
  }

  if (!thread) {
    return (
      <div className="flex items-center justify-between border-b border-border/70 bg-background/60 px-4 py-2 text-[11.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium text-foreground">New Agent</span>
          <span className="font-mono text-muted-foreground">@{workspace?.name ?? "workspace"}</span>
        </div>
        <span className="rounded bg-accent/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          Local
        </span>
      </div>
    );
  }

  const model =
    thread.model ??
    (thread.cli === "codex" ? (codexModel ?? null) : (selectedModelByCli[thread.cli] ?? null));
  const effort = thread.effort ?? null;
  const diffLabel = diffStat ? `+${diffStat.added} -${diffStat.deleted}` : "diff pending";
  const worktreeLabel = thread.branchName ?? thread.worktreePath?.split("/").pop() ?? "no worktree";

  return (
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 bg-background/60 px-4 py-2 text-[11.5px]">
      <div className="flex min-w-0 items-center gap-2">
        <ProductFavicon agent={thread.cli} label={thread.title} />
        <span className="truncate font-medium text-foreground">{thread.title}</span>
        <span className="hidden font-mono text-muted-foreground md:inline">
          @{workspace?.name ?? "workspace"}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 overflow-hidden font-mono text-[10.5px] text-muted-foreground">
        <span className="rounded bg-accent/50 px-2 py-0.5">{thread.cli}</span>
        {effort && <span className="rounded bg-accent/35 px-2 py-0.5">{effort}</span>}
        <span
          className={cn(
            "rounded px-2 py-0.5",
            thread.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-accent/35",
          )}
        >
          {thread.status}
        </span>
        {model && (
          <span className="hidden rounded bg-accent/35 px-2 py-0.5 lg:inline">{model}</span>
        )}
        <span className="hidden max-w-44 truncate rounded bg-accent/35 px-2 py-0.5 lg:inline">
          {worktreeLabel}
        </span>
        <span className="rounded bg-accent/35 px-2 py-0.5">{diffLabel}</span>
      </div>
    </div>
  );
}

export function Workspace({
  hydratingThreadFromUrl = false,
}: {
  hydratingThreadFromUrl?: boolean;
}) {
  const saveFile = useIDE((s) => s.saveFile);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [saveFile]);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <AgentThreadHeader hydratingThreadFromUrl={hydratingThreadFromUrl} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceThread hydratingThreadFromUrl={hydratingThreadFromUrl} />
      </div>
    </main>
  );
}

function WorkspaceThread({ hydratingThreadFromUrl = false }: { hydratingThreadFromUrl?: boolean }) {
  const activeThread = useActiveAgentThread();
  const taskEventsByTaskId = useIDE((s) => s.taskEventsByTaskId);
  const selectedModelByCli = useIDE((s) => s.selectedModelByCli);
  const createTaskFromPrompt = useIDE((s) => s.createTaskFromPrompt);
  const continueTaskFromPrompt = useIDE((s) => s.continueTaskFromPrompt);
  const largeDraft = useIDE((s) => s.largeComposerDraftByWorkspaceId[s.activeWorkspaceId]);
  const setLargeComposerDraft = useIDE((s) => s.setLargeComposerDraft);
  const [optimisticMessages, setOptimisticMessages] = useState<ThreadMessageLike[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!activeThread?.rootTaskId) {
      setOptimisticMessages([]);
    }
  }, [activeThread?.rootTaskId]);

  useEffect(() => {
    if (!activeThread) return;
    const state = useIDE.getState();
    for (const task of activeThread.tasks) {
      if (!state.taskEventsByTaskId[task.id]) void state.loadTaskLogs(task.id);
    }
  }, [activeThread]);

  const messages = useMemo(() => {
    if (!activeThread || activeThread.tasks.length === 0) return optimisticMessages;
    return buildAgentThreadMessages(activeThread, taskEventsByTaskId, optimisticMessages);
  }, [activeThread, taskEventsByTaskId, optimisticMessages]);
  const isRunning =
    submitting ||
    activeThread?.status === "running" ||
    activeThread?.status === "queued" ||
    activeThread?.status === "awaiting";

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const userPrompt = messagePromptFromLargeDraft(message, largeDraft);
      if (!userPrompt) return;
      const messageAttachments = messageAttachmentParts(message);
      const attachments = messageAttachments
        .map(attachmentPayload)
        .filter((attachment): attachment is AgentTaskAttachment => Boolean(attachment));

      const current = useIDE.getState();
      const thread = current.selectActiveAgentThread(current.activeWorkspaceId);
      const task =
        thread?.rootTaskId || thread?.latestTaskId
          ? ((current.tasksByWorkspaceId[current.activeWorkspaceId] ?? []).find(
              (t) => t.id === (thread.rootTaskId ?? thread.latestTaskId),
            ) ?? null)
          : null;
      const cli = (task?.cli ??
        current.composerAgentByWorkspaceId[current.activeWorkspaceId] ??
        thread?.cli ??
        current.activeAgent) as TerminalKind;
      if (!cli) {
        toast.error("Choose a CLI first");
        return;
      }
      const effort = getReasoningEffort(cli);
      const requestedModel = requestedModelForCli(current, cli);
      const planModeEnabled = isPlanModeOn(cli);
      const agentPrompt = planModeEnabled ? applyPlanModePrompt(userPrompt) : userPrompt;

      const optimisticId = `optimistic:user:${Date.now()}`;
      const optimistic: ThreadMessageLike = {
        id: optimisticId,
        role: "user",
        content: largeDraft
          ? textContentPart(summarizeLargeDraft(largeDraft))
          : appendMessageDisplayContent(message),
        attachments: messageAttachments,
        createdAt: new Date(),
        metadata: {
          custom: {
            agentPrompt: agentPrompt,
            displayPrompt: compactUserPromptForDisplay(userPrompt),
          },
        },
      };
      setOptimisticMessages((prev) => [...prev, optimistic]);
      setSubmitting(true);
      try {
        if (task) {
          await continueTaskFromPrompt(task.id, agentPrompt, {
            model: requestedModel,
            effort,
            attachments,
          });
        } else {
          const createdTask = await createTaskFromPrompt(agentPrompt, {
            cli,
            model: requestedModel,
            effort,
            displayPrompt: userPrompt,
            attachments,
          });
          if (!createdTask) {
            setOptimisticMessages((prev) => prev.filter((message) => message.id !== optimisticId));
          }
        }
      } finally {
        setLargeComposerDraft(current.activeWorkspaceId, null);
        setSubmitting(false);
      }
    },
    [continueTaskFromPrompt, createTaskFromPrompt, largeDraft, setLargeComposerDraft],
  );

  const onCancel = useCallback(async () => {
    const state = useIDE.getState();
    const taskId = state.activeTaskId;
    if (!taskId) return;
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (!workspace || workspace.source.kind !== "remote-agent") return;
    try {
      let provider = state.agentProvidersByWorkspaceId[workspace.id];
      if (!provider) {
        const { RemoteAgentProvider } = await import("@/lib/fs/remote-agent");
        provider = new RemoteAgentProvider(
          workspace.source.label,
          workspace.source.url,
          workspace.source.token,
        );
        await provider.connect();
        useIDE.setState((s) => ({
          agentProvidersByWorkspaceId: {
            ...s.agentProvidersByWorkspaceId,
            [workspace.id]: provider!,
          },
        }));
      }
      await provider.taskCancel(taskId);
    } catch (err) {
      console.error("[WorkspaceThread] cancel failed:", err);
      toast.error("Failed to cancel task");
    }
  }, []);

  const runtimeAdapter = useMemo(
    () => ({
      messages,
      convertMessage: convertExternalThreadMessage,
      isRunning,
      onNew,
      onCancel,
      adapters: {
        attachments: threadAttachmentAdapter,
      },
      suggestions:
        activeThread && activeThread.tasks.length > 0
          ? EMPTY_THREAD_SUGGESTIONS
          : NEW_TASK_THREAD_SUGGESTIONS,
    }),
    [activeThread, isRunning, messages, onCancel, onNew],
  );

  const runtime = useExternalStoreRuntime<ThreadMessageLike>(runtimeAdapter);

  if (hydratingThreadFromUrl && !activeThread) {
    return <AgentThreadHydrationSkeleton />;
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}

// Legacy split-panel layout (Files/Overview/Audit/Terminal in the top half,
// Thread in the bottom half). Kept dormant — the active layout is composer-
// only by user request. Restore by exporting this and dropping the body
// above if the dual-pane is needed later.
function WorkspaceLegacyDualPane() {
  const activeTab = useCurrentActiveTab();
  const setActiveTab = useIDE((s) => s.setActiveTab);
  const addTerminal = useIDE((s) => s.addTerminal);
  const workspaces = useIDE((s) => s.workspaces);
  const activeBranchId = useIDE((s) => s.activeBranchId);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);
  const openFiles = useCurrentOpenFiles();
  const closeFile = useIDE((s) => s.closeFile);
  const previewMode = useIDE((s) => s.previewMode);
  const tasks = useCurrentTasks();
  const currentWorktree = useCurrentWorktree();
  const currentBranches = useCurrentBranches();
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const branch = currentBranches.find((b) => b.id === activeBranchId);
  const [closedTabs, setClosedTabs] = useState<string[]>([]);

  const terminalTabs = useMemo(
    () =>
      (currentWorktree?.terminals ?? []).map((terminal) => ({
        id: `terminal:${terminal.id}` as TabId,
        label: terminal.title,
        icon: <ProductFavicon agent={terminal.kind} label={terminal.title} />,
        terminal,
      })),
    [currentWorktree],
  );

  const visibleTabs = [...staticTabs, ...terminalTabs].filter(
    (tab) => !closedTabs.includes(tab.id),
  );
  const validTabIds = new Set<TabId>([
    "overview",
    "audit",
    ...terminalTabs.map((tab) => tab.id),
    ...openFiles.map((file) => file.id),
  ]);
  const resolvedTab = validTabIds.has(activeTab) ? activeTab : (terminalTabs[0]?.id ?? "overview");
  const activeFile = openFiles.find((f) => f.id === resolvedTab) as FileTab | undefined;
  const activeTerminal = resolvedTab.startsWith("terminal:")
    ? currentWorktree?.terminals.find((terminal) => `terminal:${terminal.id}` === resolvedTab)
    : undefined;

  const saveFile = useIDE((s) => s.saveFile);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [saveFile]);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center border-b border-border">
        <div className="scrollbar-none flex flex-1 items-center overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-[13px] transition-colors",
                resolvedTab === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setClosedTabs((current) => [...current, tab.id]);
                  if (resolvedTab === tab.id) {
                    const remaining = visibleTabs.filter((candidate) => candidate.id !== tab.id);
                    setActiveTab(remaining[0]?.id ?? "overview");
                  }
                }}
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </span>
              {resolvedTab === tab.id && (
                <span className="absolute inset-x-3 -bottom-px h-[2px] bg-primary" />
              )}
            </button>
          ))}
          {openFiles.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveTab(f.id)}
              className={cn(
                "group relative flex items-center gap-2 whitespace-nowrap border-l border-border px-4 py-2.5 text-[13px] transition-colors",
                resolvedTab === f.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileCode className="h-3.5 w-3.5 text-syntax-type" />
              <span className="font-mono">{f.path.split("/").pop()}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(f.id);
                }}
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </span>
              {resolvedTab === f.id && (
                <span className="absolute inset-x-3 -bottom-px h-[2px] bg-primary" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center px-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="New agent tab"
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(
                [
                  { kind: "codex", label: "Codex" },
                  { kind: "claude", label: "Claude Code" },
                  { kind: "opencode", label: "OpenCode" },
                  { kind: "gemini", label: "Gemini" },
                ] as const
              ).map(({ kind, label }) => (
                <DropdownMenuItem
                  key={kind}
                  onSelect={() => {
                    if (!currentWorktree) return;
                    const terminalId = addTerminal(currentWorktree.id, kind);
                    setActiveTab(`terminal:${terminalId}` as TabId);
                  }}
                  className="gap-2"
                >
                  <ProductFavicon agent={kind} label={label} />
                  <span>{label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelGroup orientation="vertical" id="workspace-split" className="flex h-full flex-col">
          <Panel
            defaultSize={activeFile ? 60 : 35}
            minSize={15}
            collapsible
            collapsedSize={0}
            className="flex min-h-0"
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeFile ? (
                <FileView
                  tabId={activeFile.id}
                  path={activeFile.path}
                  content={activeFile.content}
                  loading={activeFile.loading}
                  isBinary={activeFile.isBinary}
                  isDirty={activeFile.isDirty}
                  error={activeFile.error}
                  preview={previewMode}
                />
              ) : resolvedTab === "overview" ? (
                <OverviewView />
              ) : resolvedTab === "audit" ? (
                <AuditView branchName={branch?.name ?? "—"} />
              ) : activeTerminal && currentWorktree && workspace && branch ? (
                <TerminalView
                  terminal={activeTerminal}
                  workspaceName={workspace.name}
                  branchName={branch.name}
                  worktree={currentWorktree}
                  taskCount={tasks.length}
                />
              ) : (
                <OverviewView />
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="group relative h-2 shrink-0 cursor-row-resize transition-colors hover:bg-accent/40">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/60 group-hover:bg-primary/50" />
          </PanelResizeHandle>
          <Panel defaultSize={activeFile ? 40 : 65} minSize={20} className="flex min-h-0 flex-col">
            <AgentThreadHeader />
            <div className="min-h-0 flex-1 overflow-hidden">
              <Thread />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </main>
  );
}
