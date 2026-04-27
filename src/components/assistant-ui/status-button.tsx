import { Activity } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_MODEL } from "@/lib/chat/models";
import { cn } from "@/lib/utils";
import {
  getDisplayContextWindow,
  supportsContextOverride,
  supportsOneM,
} from "@/lib/chat/context-windows";
import { useIDE, type TerminalKind } from "@/store/ide";
import { ContextRing } from "@/components/assistant-ui/context-ring";

/**
 * Small status button + popover showing live agent state for the active CLI.
 *
 * Inspired by Claude Code CLI's `/status`, `/context`, `/cost`, `/usage`
 * commands (MakFly/claude-code src/commands/*) — we surface the same
 * information without leaving the thread.
 */

function formatCompact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(n < 100_000 ? 2 : 1)}M`;
}

export const StatusButton: FC<{
  cli: TerminalKind;
  estimatedUsed: number;
  draftTokens?: number;
  runtimeModel?: string;
  runtimeUsage?: { inputTokens: number; outputTokens: number };
  runtimeContextWindow?: number;
}> = ({
  cli,
  estimatedUsed,
  draftTokens = 0,
  runtimeModel,
  runtimeUsage,
  runtimeContextWindow,
}) => {
  const selectedModelRaw = useIDE((s) => s.selectedModelByCli[cli]);
  const codexModel = useIDE((s) => s.codexModel);
  const claudeOverride = useIDE((s) => s.claudeContextOverride);
  const setClaudeOverride = useIDE((s) => s.setClaudeContextOverride);
  const codexAuth = useIDE((s) => s.codexAuth);
  const claudeApiKey = useIDE((s) => s.claudeApiKey);
  const selectedModel =
    cli === "claude"
      ? (selectedModelRaw ?? DEFAULT_CLAUDE_MODEL)
      : cli === "codex"
        ? (codexModel ?? DEFAULT_CODEX_MODEL)
        : selectedModelRaw;

  const model = selectedModel ?? runtimeModel;
  const displayMax = getDisplayContextWindow({
    cli,
    configuredModel: selectedModel,
    runtimeModel,
    runtimeContextWindow,
    override: claudeOverride,
  });
  const realUsed = runtimeUsage ? runtimeUsage.inputTokens + runtimeUsage.outputTokens : undefined;
  const displayUsed =
    realUsed !== undefined ? Math.max(realUsed + draftTokens, estimatedUsed) : estimatedUsed;
  const canOverrideContext = supportsContextOverride(cli, model);

  const authSource =
    cli === "codex"
      ? codexAuth
        ? `OAuth · ${codexAuth.email ?? "account"}`
        : "No auth configured"
      : cli === "claude"
        ? claudeApiKey
          ? "API key (env)"
          : "Claude CLI default (~/.claude)"
        : "—";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Agent status"
          className="size-8 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Activity className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              {cli}
            </span>
            <ContextRing used={displayUsed} max={displayMax} />
          </div>
          <div className="mt-1 font-mono text-[12px] text-foreground">
            {model ?? "(default model)"}
          </div>
        </div>

        <div className="space-y-2 px-3 py-2 text-[11.5px]">
          <Row label="Context used">
            <span className="tabular-nums">
              {formatCompact(displayUsed)}
              <span className="text-muted-foreground">
                {" / "}
                {formatCompact(displayMax)}
              </span>
            </span>
          </Row>
          <Row label={realUsed !== undefined ? "Last turn" : "Estimate"}>
            <span className="tabular-nums text-muted-foreground">
              {realUsed !== undefined
                ? draftTokens > 0
                  ? `↑${formatCompact(runtimeUsage!.inputTokens)} ↓${formatCompact(runtimeUsage!.outputTokens)} +${draftTokens}`
                  : `↑${formatCompact(runtimeUsage!.inputTokens)} ↓${formatCompact(runtimeUsage!.outputTokens)}`
                : "~4 chars/token"}
            </span>
          </Row>
          <Row label="Auth">
            <span className="truncate text-muted-foreground" title={authSource}>
              {authSource}
            </span>
          </Row>
        </div>

        {supportsOneM(cli, model) && (
          <div className="border-t px-3 py-2">
            <div className="mb-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Context window
            </div>
            {canOverrideContext ? (
              <div className="flex items-center gap-1">
                <OverrideChip
                  active={claudeOverride === undefined}
                  onClick={() => setClaudeOverride(undefined)}
                >
                  Auto
                </OverrideChip>
                <OverrideChip
                  active={claudeOverride === "200k"}
                  onClick={() => setClaudeOverride("200k")}
                >
                  200K
                </OverrideChip>
                <OverrideChip
                  active={claudeOverride === "1m"}
                  onClick={() => setClaudeOverride("1m")}
                >
                  1M
                </OverrideChip>
              </div>
            ) : (
              <div className="font-mono text-[11px] text-foreground">1M native</div>
            )}
            <div className="mt-1.5 text-[10.5px] text-muted-foreground">
              {canOverrideContext ? (
                <>
                  {
                    "Auto now prefers the largest window available. Opus 4.6 / Sonnet 4.6 unlock 1M via the "
                  }
                  <code className="mx-1 font-mono">[1m]</code>
                  suffix Claude Code appends to the model id — long-context pricing applies above
                  200K on API & pay-as-you-go plans.
                </>
              ) : (
                <>This model runs with a native 1M context window.</>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

const Row: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    {children}
  </div>
);

const OverrideChip: FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
      active
        ? "border-foreground/20 bg-accent text-foreground"
        : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    )}
  >
    {children}
  </button>
);
