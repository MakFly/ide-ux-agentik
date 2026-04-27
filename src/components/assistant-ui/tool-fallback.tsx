"use client";

import { memo, useCallback, useRef, useState } from "react";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  LoaderIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import {
  useScrollLock,
  type ToolCallMessagePartStatus,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { PlanStepList } from "@/components/assistant-ui/plan-part";

const ANIMATION_DURATION = 200;

export type ToolFallbackRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
};

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        lockScroll();
      }
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "aui-tool-fallback-root group/tool-fallback-root my-3 w-full overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]",
        className,
      )}
      style={
        {
          "--animation-duration": `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  );
}

type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
  "requires-action": AlertCircleIcon,
};

const statusLabelMap: Record<ToolStatus, string> = {
  running: "running",
  complete: "done",
  incomplete: "failed",
  "requires-action": "needs approval",
};

const statusClassMap: Record<ToolStatus, string> = {
  running: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  complete: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  incomplete: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  "requires-action": "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
};

type ToolDescriptor = {
  action: string;
  preview: string | null;
  Icon: React.ElementType;
};

function stringifyCompact(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stripShellWrapper(command: string): string {
  const trimmed = command.replace(/\s+/g, " ").trim();
  const match = trimmed.match(/(?:^|\/)(?:zsh|bash|sh)\s+-lc\s+(['"])([\s\S]*)\1$/);
  return match?.[2]?.trim() || trimmed;
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command))) {
    words.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return words.filter(Boolean);
}

function lastUsefulToken(command: string): string | null {
  const words = shellWords(command)
    .filter((word) => !word.startsWith("-"))
    .filter((word) => !/^\d+(,\d+)?p?$/.test(word));
  const ignored = new Set(["sed", "cat", "ls", "ig", "rg", "grep", "head", "tail", "nl"]);
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const candidate = words[i];
    if (candidate && !ignored.has(candidate)) return candidate;
  }
  return null;
}

function ellipsize(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function describeShellCommand(command: string): ToolDescriptor {
  const cleaned = stripShellWrapper(command);
  const first = shellWords(cleaned)[0] ?? "";
  const target = lastUsefulToken(cleaned);

  if (/^(sed|cat|head|tail|nl)$/.test(first)) {
    return {
      action: "Read",
      preview: target ? ellipsize(target, 72) : ellipsize(cleaned, 88),
      Icon: FileTextIcon,
    };
  }

  if (first === "ls") {
    return {
      action: "List",
      preview: target ? ellipsize(target, 72) : "workspace",
      Icon: FolderIcon,
    };
  }

  if (/^(ig|rg|grep)$/.test(first)) {
    return {
      action: "Search",
      preview: target ? ellipsize(target, 72) : ellipsize(cleaned, 88),
      Icon: SearchIcon,
    };
  }

  if (/^(curl|wget)$/.test(first)) {
    return {
      action: "Fetch",
      preview: target ? ellipsize(target, 72) : ellipsize(cleaned, 88),
      Icon: GlobeIcon,
    };
  }

  return {
    action: "Shell",
    preview: ellipsize(cleaned, 96),
    Icon: TerminalIcon,
  };
}

function describeTool(toolName: string, args: unknown, argsText?: string): ToolDescriptor {
  const normalizedToolName = toolName.toLowerCase();
  if (normalizedToolName === "shell" || normalizedToolName === "bash") {
    const commandFromArgs =
      args && typeof args === "object"
        ? stringifyCompact((args as Record<string, unknown>).command)
        : null;
    return describeShellCommand(commandFromArgs ?? argsText ?? toolName);
  }

  if (normalizedToolName === "spawn_agent") {
    const agentLabel =
      args &&
      typeof args === "object" &&
      typeof (args as Record<string, unknown>).agentLabel === "string"
        ? ((args as Record<string, unknown>).agentLabel as string)
        : null;
    return {
      action: "Sub-agent",
      preview: agentLabel ? ellipsize(agentLabel, 48) : "Launching collaborator",
      Icon: WrenchIcon,
    };
  }

  if (normalizedToolName === "spawn_agents") {
    const agents =
      args && typeof args === "object" && Array.isArray((args as Record<string, unknown>).agents)
        ? ((args as Record<string, unknown>).agents as Array<Record<string, unknown>>)
        : [];
    const labels = agents
      .map((agent) => (typeof agent.label === "string" ? agent.label.trim() : ""))
      .filter(Boolean);
    return {
      action: "Sub-agents",
      preview:
        labels.length > 0
          ? ellipsize(labels.join(" · "), 64)
          : `${agents.length || 1} collaborator${agents.length === 1 ? "" : "s"}`,
      Icon: WrenchIcon,
    };
  }

  if (normalizedToolName === "wait") {
    return {
      action: "Wait",
      preview: "Waiting for sub-agent",
      Icon: LoaderIcon,
    };
  }

  if (!args || typeof args !== "object") {
    return {
      action: toolName,
      preview: null,
      Icon: WrenchIcon,
    };
  }
  const a = args as Record<string, unknown>;
  const candidates = ["file_path", "path", "pattern", "query", "url", "command", "cmd"];
  for (const k of candidates) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) {
      const cleaned = v.replace(/\s+/g, " ").trim();
      const isSearch = k === "pattern" || k === "query";
      const isUrl = k === "url";
      return {
        action: isSearch ? "Search" : isUrl ? "Fetch" : toolName,
        preview: ellipsize(cleaned, 72),
        Icon: isSearch ? SearchIcon : isUrl ? GlobeIcon : WrenchIcon,
      };
    }
  }

  return {
    action: toolName,
    preview: null,
    Icon: WrenchIcon,
  };
}

function ToolFallbackTrigger({
  toolName,
  args,
  argsText,
  status,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  toolName: string;
  args?: unknown;
  argsText?: string;
  status?: ToolCallMessagePartStatus;
}) {
  const statusType = status?.type ?? "complete";
  const isRunning = statusType === "running";
  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";

  const Icon = statusIconMap[statusType];
  const descriptor = describeTool(toolName, args, argsText);
  const DescriptorIcon = descriptor.Icon;
  const statusLabel = isCancelled ? "cancelled" : statusLabelMap[statusType];

  return (
    <CollapsibleTrigger
      data-slot="tool-fallback-trigger"
      className={cn(
        "aui-tool-fallback-trigger group/trigger flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/35",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border",
          statusClassMap[statusType],
          isCancelled && "border-muted-foreground/20 bg-muted text-muted-foreground",
        )}
      >
        <DescriptorIcon className="size-3.5" />
      </span>
      <span
        data-slot="tool-fallback-trigger-label"
        className={cn(
          "aui-tool-fallback-trigger-label-wrapper relative grid min-w-0 grow gap-1",
          isCancelled && "text-muted-foreground line-through",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium text-foreground">{descriptor.action}</span>
          <span className="rounded-md border border-border/60 bg-muted/45 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {toolName}
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
              statusClassMap[statusType],
              isCancelled && "border-muted-foreground/20 bg-muted text-muted-foreground",
            )}
          >
            <Icon className={cn("size-3", isRunning && "animate-spin")} />
            {statusLabel}
          </span>
        </span>
        {descriptor.preview && (
          <span className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">
            {descriptor.preview}
          </span>
        )}
        {isRunning && (
          <span
            aria-hidden
            data-slot="tool-fallback-trigger-shimmer"
            className="aui-tool-fallback-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          ></span>
        )}
      </span>
      <ChevronDownIcon
        data-slot="tool-fallback-trigger-chevron"
        className={cn(
          "aui-tool-fallback-trigger-chevron size-4 shrink-0 text-muted-foreground",
          "transition-transform duration-(--animation-duration) ease-out",
          "group-data-[state=closed]/trigger:-rotate-90",
          "group-data-[state=open]/trigger:rotate-0",
        )}
      />
    </CollapsibleTrigger>
  );
}

function ToolFallbackContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      className={cn(
        "aui-tool-fallback-content relative overflow-hidden text-sm outline-none",
        "group/collapsible-content ease-out",
        "data-[state=closed]:animate-collapsible-up",
        "data-[state=open]:animate-collapsible-down",
        "data-[state=closed]:fill-mode-forwards",
        "data-[state=closed]:pointer-events-none",
        "data-[state=open]:duration-(--animation-duration)",
        "data-[state=closed]:duration-(--animation-duration)",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2 border-t border-border/60 bg-background/45 p-3">
        {children}
      </div>
    </CollapsibleContent>
  );
}

function ToolFallbackArgs({
  toolName,
  args,
  argsText,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  toolName: string;
  args?: unknown;
  argsText?: string;
}) {
  const normalizedToolName = toolName.toLowerCase();
  const isShell = normalizedToolName === "shell" || normalizedToolName === "bash";
  const fallbackArgsText =
    args === undefined ||
    args === null ||
    (typeof args === "object" && Object.keys(args as Record<string, unknown>).length === 0)
      ? null
      : typeof args === "string"
        ? args
        : JSON.stringify(args, null, 2);
  const value = argsText || fallbackArgsText;
  if (!value) return null;

  return (
    <div
      data-slot="tool-fallback-args"
      className={cn("aui-tool-fallback-args", className)}
      {...props}
    >
      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {isShell ? "Command" : "Input"}
      </p>
      <pre className="aui-tool-fallback-args-value max-h-48 overflow-auto rounded-lg border border-border/60 bg-muted/50 px-3 py-2 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-foreground/90 dark:bg-black/25">
        {isShell ? stripShellWrapper(value) : value}
      </pre>
    </div>
  );
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  result?: unknown;
}) {
  if (result === undefined) return null;

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn("aui-tool-fallback-result", className)}
      {...props}
    >
      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Output
      </p>
      <pre className="aui-tool-fallback-result-content max-h-72 overflow-auto rounded-lg border border-border/60 bg-muted/50 px-3 py-2 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-foreground/80 dark:bg-black/25">
        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  status?: ToolCallMessagePartStatus;
}) {
  if (status?.type !== "incomplete") return null;

  const error = status.error;
  const errorText = error ? (typeof error === "string" ? error : JSON.stringify(error)) : null;

  if (!errorText) return null;

  const isCancelled = status.reason === "cancelled";
  const headerText = isCancelled ? "Cancelled reason:" : "Error:";

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn(
        "aui-tool-fallback-error rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2",
        className,
      )}
      {...props}
    >
      <p className="aui-tool-fallback-error-header font-semibold text-red-300">{headerText}</p>
      <p className="aui-tool-fallback-error-reason text-red-100/80">{errorText}</p>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent = (props) => {
  const { toolName, argsText, result, status, args } = props;

  // Dispatch structured plan events to dedicated renderer.
  if (toolName === "plan") {
    return <PlanStepList {...props} />;
  }

  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";

  return (
    <ToolFallbackRoot className={cn(isCancelled && "border-muted-foreground/30 bg-muted/30")}>
      <ToolFallbackTrigger toolName={toolName} args={args} argsText={argsText} status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs
          toolName={toolName}
          args={args}
          argsText={argsText}
          className={cn(isCancelled && "opacity-60")}
        />
        {!isCancelled && <ToolFallbackResult result={result} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const ToolFallback = memo(ToolFallbackImpl) as unknown as ToolCallMessagePartComponent & {
  Root: typeof ToolFallbackRoot;
  Trigger: typeof ToolFallbackTrigger;
  Content: typeof ToolFallbackContent;
  Args: typeof ToolFallbackArgs;
  Result: typeof ToolFallbackResult;
  Error: typeof ToolFallbackError;
};

ToolFallback.displayName = "ToolFallback";
ToolFallback.Root = ToolFallbackRoot;
ToolFallback.Trigger = ToolFallbackTrigger;
ToolFallback.Content = ToolFallbackContent;
ToolFallback.Args = ToolFallbackArgs;
ToolFallback.Result = ToolFallbackResult;
ToolFallback.Error = ToolFallbackError;

export {
  ToolFallback,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
};
