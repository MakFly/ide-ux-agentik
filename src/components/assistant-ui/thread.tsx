import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Reasoning, ReasoningGroup } from "@/components/assistant-ui/reasoning";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIDE, TOKEN_CONTEXT_MAX } from "@/store/ide";
import { ModelPill } from "@/components/ide/model-pill";
import { ReasoningPill } from "@/components/ide/reasoning-pill";
import { SandboxLockButton } from "@/components/ide/sandbox-lock";
import { VoiceButton } from "@/components/ide/voice-button";
import { SkillsTrigger } from "@/components/ide/skills-trigger";
import { ComposerModeTabs } from "@/components/ide/composer-mode-tabs";
import { ComposerWorktreePicker } from "@/components/ide/composer-worktree-picker";
import { FileMentionPopover } from "@/components/ide/composer-file-mention";
import { SlashCommandPopover } from "@/components/ide/composer-slash-command";

const CLI_PLACEHOLDERS: Record<string, string> = {
  codex: "Ask Codex anything, @ to add files, / for commands",
  claude: "Ask Claude anything, @ to add files, / for commands",
  opencode: "Ask OpenCode anything, @ to add files, / for commands",
  gemini: "Ask Gemini anything, @ to add files, / for commands",
};

type PartLike = { type?: string; text?: string };
type MessageLike = { content?: ReadonlyArray<PartLike> };
function messageTextLength(m: MessageLike): number {
  if (!m.content) return 0;
  let n = 0;
  for (const p of m.content)
    if (p?.type === "text" && typeof p.text === "string") n += p.text.length;
  return n;
}

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "100%",
        ["--composer-radius" as string]: "24px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      {/* No `turnAnchor="top"` — that disables auto-scroll entirely in
          assistant-ui (see useThreadViewportAutoScroll). We want the
          ChatGPT-style "stick to bottom when new messages arrive" behavior. */}
      <ThreadPrimitive.Viewport
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-6"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <div
          data-slot="aui_message-group"
          className="mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-y-8 pb-10 empty:hidden"
        >
          <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
        </div>

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-(--composer-radius) bg-background pb-4 md:pb-6">
          <ThreadScrollToBottom />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root my-auto flex grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
            Hello there!
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200">
            How can I help you today?
          </p>
        </div>
      </div>
      <ThreadSuggestions />
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
  const activeAgent = useIDE((s) => {
    const sessions = s.sessionsByWorkspaceId[s.activeWorkspaceId] ?? [];
    const activeId = s.activeSessionIdByWorkspaceId[s.activeWorkspaceId];
    return sessions.find((t) => t.id === activeId)?.kind ?? s.activeAgent;
  });
  const placeholder = CLI_PLACEHOLDERS[activeAgent] ?? CLI_PLACEHOLDERS.codex;

  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [popover, setPopover] = useState<"files" | "slash" | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const detect = () => {
      const el = inputRef.current;
      if (!el) return;
      const caret = el.selectionStart ?? 0;
      const before = el.value.slice(0, caret);
      const m = before.match(/(?:^|\s)([@/])([^\s]*)$/);
      if (!m) {
        setPopover(null);
        setQuery("");
        return;
      }
      setQuery(m[2]);
      setPopover(m[1] === "@" ? "files" : "slash");
    };

    let current: HTMLTextAreaElement | null = null;
    const attach = (el: HTMLTextAreaElement) => {
      if (current === el) return;
      if (current) {
        current.removeEventListener("input", detect);
        current.removeEventListener("click", detect);
        current.removeEventListener("keyup", detect);
      }
      current = el;
      inputRef.current = el;
      el.addEventListener("input", detect);
      el.addEventListener("click", detect);
      el.addEventListener("keyup", detect);
      console.debug("[composer] @/slash detector attached to textarea");
    };

    const tryAttach = () => {
      const found = shell.querySelector("textarea");
      if (found) attach(found as HTMLTextAreaElement);
    };

    tryAttach();
    const observer = new MutationObserver(tryAttach);
    observer.observe(shell, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (current) {
        current.removeEventListener("input", detect);
        current.removeEventListener("click", detect);
        current.removeEventListener("keyup", detect);
      }
    };
  }, []);

  function replaceTriggerWith(replacement: string) {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const after = el.value.slice(caret);
    const m = before.match(/((?:^|\s)[@/])[^\s]*$/);
    if (!m) return;
    const startIdx = before.lastIndexOf(m[0]);
    const keepPrefix = before.slice(0, startIdx);
    const lead = m[0].startsWith(" ") ? " " : "";
    const next = keepPrefix + lead + replacement + " " + after;
    const newCaret = (keepPrefix + lead + replacement + " ").length;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.selectionStart = el.selectionEnd = newCaret;
    setPopover(null);
    setQuery("");
    el.focus();
  }

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          ref={shellRef}
          data-slot="aui_composer-shell"
          className="flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-background p-(--composer-padding) transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder={placeholder}
            className="aui-composer-input max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none placeholder:text-muted-foreground/80"
            rows={1}
            autoFocus
            aria-label="Message input"
          />
          <ComposerAction />
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
          onPick={(cmd) => replaceTriggerWith(`/${cmd.id}`)}
          onClose={() => setPopover(null)}
        />
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        <ComposerModeTabs />
        <ComposerWorktreePicker />
      </div>
    </ComposerPrimitive.Root>
  );
};

function formatCompact(n: number): string {
  if (n < 1000) return `${n}`;
  const k = n / 1000;
  return `${k.toFixed(k < 10 ? 1 : 0)}k`;
}

const TokenBadge: FC<{ used: number; max: number }> = ({ used, max }) => {
  const pct = Math.min(1, used / max);
  const warn = pct > 0.8;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "select-none font-mono text-[11px] tabular-nums",
            warn ? "text-status-warn" : "text-muted-foreground",
          )}
          aria-label="Context tokens"
        >
          ctx {formatCompact(used)}/{formatCompact(max)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Estimated context usage (~4 chars / token)</TooltipContent>
    </Tooltip>
  );
};

const ComposerAction: FC = () => {
  const activeAgent = useIDE((s) => {
    const sessions = s.sessionsByWorkspaceId[s.activeWorkspaceId] ?? [];
    const activeId = s.activeSessionIdByWorkspaceId[s.activeWorkspaceId];
    return sessions.find((t) => t.id === activeId)?.kind ?? s.activeAgent;
  });
  const messagesChars = useAuiState((s) =>
    s.thread.messages.reduce((acc, m) => acc + messageTextLength(m as MessageLike), 0),
  );
  const composerChars = useAuiState((s) => (s.composer.text ?? "").length);
  const used = Math.round((messagesChars + composerChars) / 4);
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        <ModelPill cli={activeAgent} />
        <ReasoningPill cli={activeAgent} />
        <SkillsTrigger />
      </div>
      <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2">
        <TokenBadge used={used} max={TOKEN_CONTEXT_MAX} />
      </div>
      <div className="flex items-center gap-1">
        <SandboxLockButton cli={activeAgent} />
        <VoiceButton />
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-8 rounded-full"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-8 rounded-full"
              aria-label="Stop generating"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
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
  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative animate-in duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="wrap-break-word px-2 text-foreground leading-relaxed"
      >
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning,
            ReasoningGroup,
            tools: { Fallback: ToolFallback },
          }}
        />
        <AuiIf condition={(s) => s.thread.isRunning && s.message.content.length === 0}>
          <div className="flex items-center gap-2 text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" />
            <span className="text-sm">Thinking…</span>
          </div>
        </AuiIf>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ml-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 grid animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -mr-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root data-slot="aui_edit-composer-wrapper" className="flex flex-col px-2">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
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
