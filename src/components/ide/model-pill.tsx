import { ChevronDown, Cpu } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CODEX_MODELS, DEFAULT_CODEX_MODEL } from "@/lib/chat/models";
import { cn } from "@/lib/utils";
import { useIDE } from "@/store/ide";
import type { TerminalKind } from "@/store/ide";

type ModelEntry = { id: string; label: string; description: string };

const CLAUDE_MODELS: readonly ModelEntry[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", description: "Most capable, 1M context" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "Balanced speed & quality" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fast & efficient" },
] as const;

const OPENCODE_MODELS: readonly ModelEntry[] = [
  { id: "default", label: "Default", description: "OpenCode auto-selects" },
  { id: "gpt-4o", label: "GPT-4o", description: "OpenAI via OpenCode" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "Anthropic via OpenCode" },
] as const;

const GEMINI_MODELS: readonly ModelEntry[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Highest quality" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Fast & cost-efficient" },
] as const;

const DEFAULT_BY_CLI: Record<TerminalKind, string> = {
  codex: DEFAULT_CODEX_MODEL,
  claude: "claude-sonnet-4-6",
  opencode: "default",
  gemini: "gemini-2.5-pro",
};

const LABEL_BY_CLI: Record<TerminalKind, string> = {
  codex: "Codex model",
  claude: "Claude model",
  opencode: "OpenCode model",
  gemini: "Gemini model",
};

function catalogFor(cli: TerminalKind): readonly ModelEntry[] {
  if (cli === "codex") return CODEX_MODELS;
  if (cli === "claude") return CLAUDE_MODELS;
  if (cli === "opencode") return OPENCODE_MODELS;
  return GEMINI_MODELS;
}

export function ModelPill({ cli }: { cli: TerminalKind }) {
  const selectedModelByCli = useIDE((s) => s.selectedModelByCli);
  const setModelForCli = useIDE((s) => s.setModelForCli);
  const codexModel = useIDE((s) => s.codexModel);
  const setCodexModel = useIDE((s) => s.setCodexModel);

  const catalog = catalogFor(cli);
  const defaultId = DEFAULT_BY_CLI[cli];

  const currentId =
    cli === "codex"
      ? (codexModel ?? defaultId)
      : (selectedModelByCli[cli] ?? defaultId);

  const current = catalog.find((m) => m.id === currentId) ?? catalog[0];

  function handleSelect(id: string) {
    if (cli === "codex") {
      setCodexModel(id === DEFAULT_CODEX_MODEL ? undefined : id);
    } else {
      setModelForCli(cli, id);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="model-pill"
          className="flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Cpu className="h-3 w-3" />
          <span>{current.label}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <div className="px-2 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
          {LABEL_BY_CLI[cli]}
        </div>
        {catalog.map((m) => {
          const active = m.id === current.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => handleSelect(m.id)}
              className={cn(
                "flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition-colors hover:bg-accent",
                active && "bg-accent/60",
              )}
            >
              <span className="font-mono text-[12.5px] text-foreground">{m.label}</span>
              <span className="text-[11px] text-muted-foreground">{m.description}</span>
            </button>
          );
        })}
        {cli !== "codex" && (
          <p className="px-2 py-1.5 text-[10.5px] text-muted-foreground/70">
            Experimental — adapter not fully wired yet.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
