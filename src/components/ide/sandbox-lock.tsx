import { Lock, ShieldCheck, Unlock } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TerminalKind } from "@/store/ide";

type SandboxMode = "sandbox" | "confirm" | "auto";

const STORAGE_KEY = "sandbox-mode-by-cli";

const CYCLE: Record<SandboxMode, SandboxMode> = {
  sandbox: "confirm",
  confirm: "auto",
  auto: "sandbox",
};

const META: Record<SandboxMode, { label: string; description: string; className: string }> = {
  sandbox: {
    label: "Sandbox",
    description: "Read-only",
    className: "text-destructive hover:text-destructive",
  },
  confirm: {
    label: "Confirm",
    description: "Ask before each tool",
    className: "text-muted-foreground",
  },
  auto: {
    label: "Auto",
    description: "All tools automatic",
    className: "text-green-500",
  },
};

function readStore(): Record<TerminalKind, SandboxMode> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {} as Record<TerminalKind, SandboxMode>;
  }
}

export function useSandboxMode(
  cli: TerminalKind,
): [SandboxMode, () => void, (v: SandboxMode) => void] {
  const get = (): SandboxMode => readStore()[cli] ?? "confirm";

  const set = useCallback(
    (v: SandboxMode) => {
      const store = readStore();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store, [cli]: v }));
    },
    [cli],
  );

  const cycle = useCallback(() => {
    set(CYCLE[get()]);
  }, [cli, set]);

  return [get(), cycle, set];
}

const ICON: Record<SandboxMode, React.ComponentType<{ className?: string }>> = {
  sandbox: Lock,
  confirm: ShieldCheck,
  auto: Unlock,
};

export function SandboxLockButton({ cli }: { cli: TerminalKind }) {
  const [mode, cycle] = useSandboxMode(cli);
  const meta = META[mode];
  const Icon = ICON[mode];

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={cycle}
            className={meta.className}
            aria-label={`Sandbox mode: ${meta.label}`}
          >
            <Icon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="font-medium">{meta.label}</span>
          <span className="text-muted-foreground ml-1">— {meta.description}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
