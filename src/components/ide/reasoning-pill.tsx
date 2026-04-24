import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TerminalKind } from "@/store/ide";

type ReasoningEffort = "low" | "medium" | "high" | "extra-high";

const EFFORTS: { value: ReasoningEffort; label: string; description: string }[] = [
  { value: "low", label: "Low", description: "Faster, less compute" },
  { value: "medium", label: "Medium", description: "Balanced speed & depth" },
  { value: "high", label: "High", description: "Deep reasoning" },
  { value: "extra-high", label: "Extra High", description: "Maximum reasoning effort" },
];

const DEFAULT_EFFORT: ReasoningEffort = "high";
const STORAGE_KEY = "reasoning-effort-by-cli";

function readStore(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function useReasoningEffort(
  cli: TerminalKind,
): [ReasoningEffort, (v: ReasoningEffort) => void] {
  const [effort, setEffortState] = useState<ReasoningEffort>(() => {
    const stored = readStore()[cli];
    return EFFORTS.find((e) => e.value === stored)?.value ?? DEFAULT_EFFORT;
  });

  function setValue(v: ReasoningEffort) {
    const next = { ...readStore(), [cli]: v };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setEffortState(v);
  }

  return [effort, setValue];
}

export function ReasoningPill({ cli }: { cli: TerminalKind }) {
  const [effort, setEffort] = useReasoningEffort(cli);
  const current = EFFORTS.find((e) => e.value === effort) ?? EFFORTS[2];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="reasoning-pill"
          className="flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Sparkles className="h-3 w-3" />
          <span>{current.label}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="px-2 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Reasoning effort
        </div>
        {EFFORTS.map((e) => {
          const active = e.value === current.value;
          return (
            <button
              key={e.value}
              type="button"
              onClick={() => setEffort(e.value)}
              className={cn(
                "flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition-colors hover:bg-accent",
                active && "bg-accent/60",
              )}
            >
              <span className="font-mono text-[12.5px] text-foreground">{e.label}</span>
              <span className="text-[11px] text-muted-foreground">{e.description}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
