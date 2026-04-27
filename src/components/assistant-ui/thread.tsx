import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Reasoning, ReasoningGroup } from "@/components/assistant-ui/reasoning";
import { ThinkingIndicator } from "@/components/assistant-ui/thinking-indicator";
import { useRunTracker, useRegisterThreadStateRef } from "@/hooks/use-message-summary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAssistantRuntime,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { toast } from "sonner";
import { useIDE, type LargeComposerDraft, type TerminalKind } from "@/store/ide";
import { ModelPill } from "@/components/ide/model-pill";
import { ReasoningPill } from "@/components/ide/reasoning-pill";
import { ContextRing } from "@/components/assistant-ui/context-ring";
import { StatusButton } from "@/components/assistant-ui/status-button";
import { getDisplayContextWindow } from "@/lib/chat/context-windows";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_MODEL } from "@/lib/chat/models";
import { PlanToggle } from "@/components/ide/plan-toggle";
import { ComposerModeTabs } from "@/components/ide/composer-mode-tabs";
import { FileMentionPopover } from "@/components/ide/composer-file-mention";
import { SlashCommandPopover } from "@/components/ide/composer-slash-command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { executeSlash, maybeInterceptSlash, SLASH_COMMANDS } from "@/lib/chat/slash-commands";

const CLI_PLACEHOLDERS: Record<string, string> = {
  codex: "Ask Codex anything, @ to add files, / for commands",
  claude: "Ask Claude anything, @ to add files, / for commands",
  opencode: "Ask OpenCode anything, @ to add files, / for commands",
  gemini: "Ask Gemini anything, @ to add files, / for commands",
};

const CLI_OPTIONS: Array<{ id: TerminalKind; label: string; detail: string; icon: string }> = [
  { id: "codex", label: "Codex", detail: "OpenAI CLI", icon: "/agents/codex.svg" },
  { id: "claude", label: "Claude", detail: "Claude Code", icon: "/agents/claude-code.svg" },
  { id: "gemini", label: "Gemini", detail: "Google CLI", icon: "/agents/gemini.svg" },
  { id: "opencode", label: "OpenCode", detail: "OpenCode run", icon: "/agents/opencode.ico" },
];

const MAX_INLINE_COMPOSER_CHARS = 12_000;

type PartLike = { type?: string; text?: string };
type MessageLike = {
  role?: string;
  content?: ReadonlyArray<PartLike>;
  metadata?: { custom?: Record<string, unknown> };
};
type SnapshotKind = "cumulative" | "perTurn";
type CliContextSnapshot = {
  kind: SnapshotKind;
  /** Stable id used to dedupe per-turn snapshots (Claude message.id). */
  turnKey?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  contextWindow?: number;
};

function buildLargeDraftPreview(text: string): string {
  const omitted = Math.max(0, text.length - MAX_INLINE_COMPOSER_CHARS);
  const head = text.slice(0, MAX_INLINE_COMPOSER_CHARS);
  const notice =
    omitted > 0
      ? `[Large draft collapsed for performance: ${omitted.toLocaleString("en-US")} hidden chars]\n\n`
      : "";
  return `${notice}${head}`;
}

function largeDraftHiddenChars(draft: LargeComposerDraft): number {
  return Math.max(0, draft.fullText.length - draft.previewText.length);
}

function messageTextLength(m: MessageLike): number {
  const agentPrompt = m.metadata?.custom?.agentPrompt;
  if (m.role === "user" && typeof agentPrompt === "string") return agentPrompt.length;

  if (!m.content) return 0;
  let n = 0;
  for (const p of m.content)
    if (p?.type === "text" && typeof p.text === "string") n += p.text.length;
  return n;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function inputTokensFromUsage(u: Record<string, unknown>): number | undefined {
  const total =
    (num(u.input_tokens) ?? num(u.inputTokens) ?? 0) +
    (num(u.cache_creation_input_tokens) ?? num(u.cacheCreationInputTokens) ?? 0) +
    (num(u.cache_read_input_tokens) ?? num(u.cacheReadInputTokens) ?? 0);
  return total || undefined;
}

function outputTokensFromUsage(u: Record<string, unknown>): number | undefined {
  return num(u.output_tokens) ?? num(u.outputTokens);
}

function runtimeModelFromUsageKey(key: string): string {
  return key.replace(/\[.*\]$/, "");
}

function contextSnapshotFromEvent(data: unknown): CliContextSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const modelUsage = obj.modelUsage;
  if (modelUsage && typeof modelUsage === "object") {
    const entries = Object.entries(modelUsage as Record<string, Record<string, unknown>>);
    const [modelKey, usage] = entries[entries.length - 1] ?? [];
    if (modelKey && usage) {
      return {
        kind: "cumulative",
        model: runtimeModelFromUsageKey(modelKey),
        inputTokens: inputTokensFromUsage(usage),
        outputTokens: outputTokensFromUsage(usage),
        contextWindow: num(usage.contextWindow),
      };
    }
  }

  // Claude `--output-format stream-json` emits successive `assistant`
  // events for the SAME message.id — usage.input_tokens stays constant for
  // a turn while output_tokens grows. We dedupe by message.id so multiple
  // streamed snapshots of the same turn don't get summed.
  const message = obj.message;
  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>;
    const usage = msg.usage;
    if (usage && typeof usage === "object") {
      const u = usage as Record<string, unknown>;
      return {
        kind: "perTurn",
        turnKey: typeof msg.id === "string" ? msg.id : undefined,
        model: typeof msg.model === "string" ? msg.model : undefined,
        inputTokens: inputTokensFromUsage(u),
        outputTokens: outputTokensFromUsage(u),
      };
    }
  }

  // Claude `result` event: canonical session total at the end of a task.
  if (obj.type === "result") {
    const u = obj.usage as Record<string, unknown> | undefined;
    if (u && typeof u === "object") {
      return {
        kind: "cumulative",
        model: typeof obj.model === "string" ? obj.model : undefined,
        inputTokens: inputTokensFromUsage(u),
        outputTokens: outputTokensFromUsage(u),
      };
    }
  }

  // Generic per-turn fallback (Codex CLI deltas, OpenAI-style chunks).
  const usage = obj.usage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    return {
      kind: "perTurn",
      turnKey: typeof obj.id === "string" ? obj.id : undefined,
      model: typeof obj.model === "string" ? obj.model : undefined,
      inputTokens: inputTokensFromUsage(u),
      outputTokens: outputTokensFromUsage(u),
    };
  }

  return null;
}

function latestContextSnapshot(eventsByTaskId: Record<string, unknown[]>, taskIds: string[]) {
  let cumulativeIn: number | undefined;
  let cumulativeOut: number | undefined;
  // Per-turn aggregation: keep the LATEST usage per turnKey to avoid double
  // counting Claude's repeated `assistant` events for the same message.
  const perTurn = new Map<string, { in: number; out: number }>();
  // Anonymous per-turn snapshots (no turnKey) get bucketed under their
  // index so each event is its own bucket — keeps Codex/OpenAI delta chunks
  // working as a fallback.
  let anonIdx = 0;
  let model: string | undefined;
  let contextWindow: number | undefined;
  let saw = false;
  for (const taskId of taskIds) {
    for (const entry of eventsByTaskId[taskId] ?? []) {
      const data = (entry as { data?: unknown })?.data;
      const snap = contextSnapshotFromEvent(data);
      if (!snap) continue;
      saw = true;
      if (snap.model) model = snap.model;
      if (snap.contextWindow !== undefined) contextWindow = snap.contextWindow;
      if (snap.kind === "cumulative") {
        cumulativeIn = snap.inputTokens ?? cumulativeIn;
        cumulativeOut = snap.outputTokens ?? cumulativeOut;
        perTurn.clear();
      } else {
        const key = snap.turnKey ?? `__anon_${anonIdx++}`;
        perTurn.set(key, {
          in: snap.inputTokens ?? 0,
          out: snap.outputTokens ?? 0,
        });
      }
    }
  }
  if (!saw) return null;
  let summedIn = 0;
  let summedOut = 0;
  for (const v of perTurn.values()) {
    summedIn += v.in;
    summedOut += v.out;
  }
  const inputTokens = (cumulativeIn ?? 0) + summedIn;
  const outputTokens = (cumulativeOut ?? 0) + summedOut;
  return {
    kind: "cumulative" as const,
    model,
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    contextWindow,
  };
}

export const Thread: FC = () => {
  // Track run timing and tool counts for "Thought for Xs" summaries.
  useRunTracker();
  useRegisterThreadStateRef();

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background text-sm"
      style={{
        ["--thread-max-width" as string]: "48rem",
        ["--accent-color" as string]: "#10a37f",
        ["--accent-foreground" as string]: "#ffffff",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        data-testid="chat-thread"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            EditComposer,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 overflow-visible rounded-t-3xl bg-background pb-4">
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadWelcome: FC = () => {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const selectedCli = useIDE((s) => s.composerAgentByWorkspaceId[s.activeWorkspaceId]);
  const setComposerAgent = useIDE((s) => s.setComposerAgent);

  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
      <div className="flex w-full flex-grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center px-8">
          <div className="fade-in slide-in-from-bottom-1 animate-in text-2xl font-semibold duration-200">
            Hello there!
          </div>
          <div className="fade-in slide-in-from-bottom-1 animate-in text-2xl text-muted-foreground/65 delay-75 duration-200">
            How can I help you today?
          </div>
          <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {CLI_OPTIONS.map((cli) => {
              const active = selectedCli === cli.id;
              return (
                <button
                  key={cli.id}
                  type="button"
                  onClick={() => setComposerAgent(workspaceId, cli.id)}
                  className={cn(
                    "group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all",
                    "bg-card/80 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40",
                    active && "border-primary bg-primary/10 shadow-sm shadow-primary/10",
                  )}
                  aria-pressed={active}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border bg-background">
                    <img src={cli.icon} alt="" className="h-5 w-5 object-contain" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-foreground">
                      {cli.label}
                    </span>
                    <span className="block text-[11.5px] text-muted-foreground">{cli.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {selectedCli && <ThreadSuggestions />}
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions grid w-full @md:grid-cols-2 gap-2 pb-4">
      <ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 @md:nth-[n+3]:block nth-[n+3]:hidden animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion h-auto w-full @md:flex-col flex-wrap items-start justify-start gap-1 rounded-3xl border bg-background px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 font-medium" />
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC = () => {
  const workspaceId = useIDE((s) => s.activeWorkspaceId);
  const largeDraft = useIDE((s) => s.largeComposerDraftByWorkspaceId[s.activeWorkspaceId]);
  const activeAgent = useIDE((s) => {
    const activeThread = s.selectActiveAgentThread(s.activeWorkspaceId);
    if (activeThread?.cli) return activeThread.cli;
    const composerAgent = s.composerAgentByWorkspaceId[s.activeWorkspaceId];
    if (composerAgent) return composerAgent;
    const sessions = s.sessionsByWorkspaceId[s.activeWorkspaceId] ?? [];
    const activeId = s.activeSessionIdByWorkspaceId[s.activeWorkspaceId];
    return sessions.find((t) => t.id === activeId)?.kind ?? s.activeAgent;
  });
  const requiresCli = useIDE((s) => {
    const activeThread = s.selectActiveAgentThread(s.activeWorkspaceId);
    return (
      !activeThread &&
      !s.composerAgentByWorkspaceId[s.activeWorkspaceId] &&
      !s.activeSessionIdByWorkspaceId[s.activeWorkspaceId]
    );
  });

  const placeholder = CLI_PLACEHOLDERS[activeAgent] ?? CLI_PLACEHOLDERS.codex;

  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputGuardRef = useRef(false);
  const [inputReadyTick, setInputReadyTick] = useState(0);
  const [popover, setPopover] = useState<"files" | "slash" | null>(null);
  const [query, setQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const setLargeComposerDraft = useIDE((s) => s.setLargeComposerDraft);

  // Reactive detection: watch composer.text directly from the assistant-ui
  // runtime. More reliable than attaching DOM listeners — React re-runs this
  // effect on every keystroke.
  const composerText = useAuiState((s) => s.composer.text ?? "");

  useEffect(() => {
    // Cache the textarea node so replaceTriggerWith can still reach it.
    if (!inputRef.current) {
      const shell = shellRef.current;
      if (shell) {
        const found = shell.querySelector("textarea");
        if (found) {
          inputRef.current = found as HTMLTextAreaElement;
          setInputReadyTick((tick) => tick + 1);
        }
      }
    }

    const text = composerText;
    if (!text) {
      setPopover(null);
      setQuery("");
      return;
    }

    // Extract last whitespace-separated token.
    const match = text.match(/(?:^|\s)([@/])([^\s]*)$/);
    if (!match) {
      setPopover(null);
      setQuery("");
      return;
    }

    const trigger = match[1];
    const q = match[2];
    setQuery(q);
    setPopover(trigger === "@" ? "files" : "slash");
    console.debug("[composer] trigger=", trigger, "query=", q);
  }, [composerText]);

  useEffect(() => {
    if (composerText.length > MAX_INLINE_COMPOSER_CHARS) {
      const previewText = buildLargeDraftPreview(composerText);
      if (
        !largeDraft ||
        largeDraft.fullText !== composerText ||
        largeDraft.previewText !== previewText
      ) {
        setLargeComposerDraft(workspaceId, {
          fullText: composerText,
          previewText,
        });
        const el = inputRef.current;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (el && setter && el.value !== previewText) {
          inputGuardRef.current = true;
          setter.call(el, previewText);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.selectionStart = el.selectionEnd = 0;
        }
      }
      return;
    }

    if (largeDraft) setLargeComposerDraft(workspaceId, null);
  }, [composerText, largeDraft, setLargeComposerDraft, workspaceId]);

  useEffect(() => {
    const el =
      inputRef.current ??
      ((shellRef.current?.querySelector("textarea") as HTMLTextAreaElement) || null);
    if (!el) return;
    inputRef.current = el;

    const handler = () => {
      if (inputGuardRef.current) {
        inputGuardRef.current = false;
        return;
      }

      const currentValue = el.value;
      const currentDraft = useIDE.getState().largeComposerDraftByWorkspaceId[workspaceId];

      if (currentValue.length > MAX_INLINE_COMPOSER_CHARS) {
        const previewText = buildLargeDraftPreview(currentValue);
        setLargeComposerDraft(workspaceId, {
          fullText: currentValue,
          previewText,
        });
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        inputGuardRef.current = true;
        setter?.call(el, previewText);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.selectionStart = el.selectionEnd = 0;
        toast.warning("Large draft collapsed for performance", {
          id: `large-draft-${workspaceId}`,
          description: "The full prompt is preserved for send/context counting.",
        });
        return;
      }

      if (currentDraft) setLargeComposerDraft(workspaceId, null);
    };

    el.addEventListener("input", handler, true);
    return () => el.removeEventListener("input", handler, true);
  }, [inputReadyTick, setLargeComposerDraft, workspaceId]);

  // Split into individual primitive/ref selectors so each one is snapshot-stable
  // (useSyncExternalStore would otherwise loop on a fresh object every call).
  const workspaceSource = useIDE(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.source,
  );
  const sessionId = useIDE((s) => s.activeSessionIdByWorkspaceId[s.activeWorkspaceId]);
  const slashCtx = useMemo(
    () => ({ workspaceSource, sessionId, workspaceId }),
    [workspaceSource, sessionId, workspaceId],
  );

  /** Programmatically clear the assistant-ui composer textarea. */
  function clearInput() {
    const el = inputRef.current;
    if (!el) return;
    setLargeComposerDraft(workspaceId, null);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function replaceTriggerWith(replacement: string) {
    const el = inputRef.current;
    if (!el) return;
    // Replace the last @-token or /-token with `replacement ` (replacement
    // already carries its @/ prefix). Preserves leading whitespace so
    // "ask @fo" → "ask @src/foo.ts ".
    const next = el.value.replace(/((?:^|\s))[@/][^\s]*$/, `$1${replacement} `);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.selectionStart = el.selectionEnd = next.length;
    setPopover(null);
    setQuery("");
    el.focus();
  }

  /** Called when user picks a builtin from the popover. */
  function handleBuiltinPick(cmdId: string) {
    setPopover(null);
    setQuery("");
    clearInput();
    void executeSlash(cmdId, { ...slashCtx, onHelp: () => setHelpOpen(true) });
  }

  if (requiresCli) return null;

  return (
    <>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            ref={shellRef}
            data-slot="aui_composer-shell"
            className="flex w-full flex-col rounded-3xl border border-input bg-background px-1 pt-2 outline-none transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
          >
            <ComposerAttachments />
            <ComposerPrimitive.Input
              data-testid="chat-composer-input"
              placeholder={placeholder}
              disabled={requiresCli}
              className="aui-composer-input mb-1 max-h-32 min-h-14 w-full resize-none bg-transparent px-4 pt-2 pb-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
              rows={1}
              autoFocus
              aria-label="Message input"
            />
            {largeDraft && (
              <div className="mx-3 mb-2 rounded-xl border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-[11px] text-status-warn">
                <span className="font-medium">Large draft mode.</span>{" "}
                {largeDraft.fullText.length.toLocaleString("en-US")} chars buffered,{" "}
                {largeDraftHiddenChars(largeDraft).toLocaleString("en-US")} hidden from the textarea
                for performance.
              </div>
            )}
            <ComposerAction onHelp={() => setHelpOpen(true)} />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
        {popover === "files" && (
          <FileMentionPopover
            anchorRef={shellRef}
            query={query}
            onPick={(path) => replaceTriggerWith(`@${path}`)}
            onClose={() => setPopover(null)}
          />
        )}
        {popover === "slash" && (
          <SlashCommandPopover
            anchorRef={shellRef}
            query={query}
            onPick={(cmd) => {
              if (cmd.kind === "builtin") {
                handleBuiltinPick(cmd.id);
              } else {
                replaceTriggerWith(`/${cmd.id}`);
              }
            }}
            onClose={() => setPopover(null)}
          />
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <ComposerModeTabs />
        </div>
      </ComposerPrimitive.Root>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
};

const HelpDialog: FC<{ open: boolean; onOpenChange: (v: boolean) => void }> = ({
  open,
  onOpenChange,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Slash commands</DialogTitle>
      </DialogHeader>
      <div className="mt-2 space-y-3">
        {SLASH_COMMANDS.filter((c) => c.id !== "reset" && c.id !== "new").map((cmd) => (
          <div key={cmd.id} className="flex flex-col gap-0.5">
            <span className="font-mono text-sm font-medium">{cmd.label}</span>
            <span className="text-[12px] text-muted-foreground">{cmd.description}</span>
            {cmd.aliases && cmd.aliases.length > 0 && (
              <span className="text-[11px] text-muted-foreground/60">
                aliases: {cmd.aliases.map((a) => `/${a}`).join(", ")}
              </span>
            )}
          </div>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);

const SendOrStopButton: FC = () => {
  const runtime = useAssistantRuntime();
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const composerText = useAuiState((s) => s.composer.text ?? "");
  const composerAttachmentsCount = useAuiState((s) => s.composer.attachments.length);
  const requiresCli = useIDE(
    (s) =>
      !s.activeTaskId &&
      !s.composerAgentByWorkspaceId[s.activeWorkspaceId] &&
      !s.activeSessionIdByWorkspaceId[s.activeWorkspaceId],
  );

  if (isRunning) {
    return (
      <Button
        type="button"
        variant="default"
        size="icon"
        className="aui-composer-cancel size-8 rounded-full"
        style={{
          backgroundColor: "var(--accent-color)",
          color: "var(--accent-foreground)",
        }}
        aria-label="Stop generating"
        data-testid="chat-composer-stop"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          let cancelled = false;
          try {
            runtime.thread.cancelRun();
            cancelled = true;
            console.debug("[composer] cancelRun fired (runtime.thread)");
          } catch (err) {
            console.warn("[composer] runtime.thread.cancelRun failed:", err);
          }
          if (!cancelled) {
            try {
              aui.threads().__internal_getAssistantRuntime?.()?.thread.cancelRun();
              console.debug("[composer] cancelRun fired (aui fallback)");
            } catch (err) {
              console.warn("[composer] aui cancelRun failed:", err);
            }
          }
        }}
      >
        <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
      </Button>
    );
  }

  return (
    <ComposerPrimitive.Send asChild>
      <TooltipIconButton
        tooltip="Send message"
        side="bottom"
        type="button"
        variant="default"
        size="icon"
        className="aui-composer-send size-8 rounded-full"
        style={{
          backgroundColor: "var(--accent-color)",
          color: "var(--accent-foreground)",
        }}
        aria-label="Send message"
        disabled={(!composerText.trim() && composerAttachmentsCount === 0) || requiresCli}
      >
        <ArrowUpIcon className="aui-composer-send-icon size-4" />
      </TooltipIconButton>
    </ComposerPrimitive.Send>
  );
};

const ComposerAction: FC<{ onHelp?: () => void }> = ({ onHelp: _onHelp }) => {
  const activeTaskId = useIDE((s) => s.activeTaskId);
  const activeThreadTaskIdsKey = useIDE((s) => {
    const thread = s.selectActiveAgentThread(s.activeWorkspaceId);
    return thread?.tasks.map((task) => task.id).join(",") ?? "";
  });
  const activeAgent = useIDE((s) => {
    const activeThread = s.selectActiveAgentThread(s.activeWorkspaceId);
    if (activeThread?.cli) return activeThread.cli;
    const composerAgent = s.composerAgentByWorkspaceId[s.activeWorkspaceId];
    if (composerAgent) return composerAgent;
    const sessions = s.sessionsByWorkspaceId[s.activeWorkspaceId] ?? [];
    const activeId = s.activeSessionIdByWorkspaceId[s.activeWorkspaceId];
    return sessions.find((t) => t.id === activeId)?.kind ?? s.activeAgent;
  });
  const messagesChars = useAuiState((s) =>
    s.thread.messages.reduce((acc, m) => acc + messageTextLength(m as MessageLike), 0),
  );
  const largeDraft = useIDE((s) => s.largeComposerDraftByWorkspaceId[s.activeWorkspaceId]);
  const composerChars = useAuiState((s) =>
    largeDraft ? largeDraft.fullText.length : (s.composer.text ?? "").length,
  );
  const draftTokens = Math.round(composerChars / 4);
  const estimatedUsed = Math.round((messagesChars + composerChars) / 4);
  const configuredModel = useIDE((s) => {
    const selected = s.selectedModelByCli[activeAgent];
    if (activeAgent === "claude") return selected ?? DEFAULT_CLAUDE_MODEL;
    if (activeAgent === "codex") return s.codexModel ?? DEFAULT_CODEX_MODEL;
    return selected;
  });
  const claudeOverride = useIDE((s) => s.claudeContextOverride);
  const taskEventsByTaskId = useIDE((s) => s.taskEventsByTaskId);
  const contextTaskIds = useMemo(
    () =>
      activeThreadTaskIdsKey
        ? activeThreadTaskIdsKey.split(",").filter(Boolean)
        : activeTaskId
          ? [activeTaskId]
          : [],
    [activeTaskId, activeThreadTaskIdsKey],
  );
  const cliContext = useMemo(
    () => latestContextSnapshot(taskEventsByTaskId, contextTaskIds),
    [contextTaskIds, taskEventsByTaskId],
  );
  const model = cliContext?.model ?? configuredModel;
  const realUsed =
    cliContext?.inputTokens !== undefined && cliContext.outputTokens !== undefined
      ? cliContext.inputTokens + cliContext.outputTokens
      : undefined;
  const used =
    realUsed !== undefined ? Math.max(realUsed + draftTokens, estimatedUsed) : estimatedUsed;
  const max = getDisplayContextWindow({
    cli: activeAgent,
    configuredModel: configuredModel,
    runtimeModel: model,
    runtimeContextWindow: cliContext?.contextWindow,
    override: claudeOverride,
  });

  return (
    <div className="aui-composer-action-wrapper relative mx-2 mb-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        <ModelPill cli={activeAgent} />
        <ReasoningPill cli={activeAgent} />
        <PlanToggle cli={activeAgent} />
      </div>
      <div className="flex items-center gap-1">
        <span className="hidden h-8 items-center justify-center sm:inline-flex">
          <ContextRing used={used} max={max} />
        </span>
        <StatusButton
          cli={activeAgent}
          estimatedUsed={estimatedUsed}
          draftTokens={draftTokens}
          runtimeModel={model}
          runtimeUsage={
            cliContext?.inputTokens !== undefined && cliContext.outputTokens !== undefined
              ? { inputTokens: cliContext.inputTokens, outputTokens: cliContext.outputTokens }
              : undefined
          }
          runtimeContextWindow={cliContext?.contextWindow}
        />
        <SendOrStopButton />
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-[var(--thread-max-width)] animate-in py-3 duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="wrap-break-word break-words px-2 leading-relaxed text-foreground"
      >
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: { Fallback: ToolFallback },
            Reasoning,
            ReasoningGroup,
          }}
        />
        <MessageError />
        <ThinkingIndicator />
      </div>

      <div data-slot="aui_assistant-message-footer" className="mt-1 ml-2 flex min-h-6 items-center">
        <BranchPicker />
      </div>
    </MessagePrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-[var(--thread-max-width)] animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word rounded-3xl bg-muted px-4 py-2.5 break-words text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
          <UserActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col px-2 py-3"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-3xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
