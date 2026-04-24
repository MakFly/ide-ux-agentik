import { ChevronDown, Lock, ShieldCheck, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useIDE } from "@/store/ide";
import type { TerminalKind } from "@/store/ide";

export type ApprovalMode = "auto" | "confirm" | "sandbox";

const MODES: {
  id: ApprovalMode;
  label: string;
  description: string;
  Icon: React.ElementType;
}[] = [
  {
    id: "auto",
    label: "Auto",
    description: "All tools run without confirmation",
    Icon: Zap,
  },
  {
    id: "confirm",
    label: "Confirm",
    description: "Ask before each tool call",
    Icon: ShieldCheck,
  },
  {
    id: "sandbox",
    label: "Sandbox",
    description: "Read-only — no writes or shell",
    Icon: Lock,
  },
];

export function ApprovalPill({ cli }: { cli: TerminalKind }) {
  // TODO: wire `approvalMode` to `chat.spawn` extraArgs in agent/server.ts
  //       codex flag: --ask-for-approval (confirm) / --dangerously-bypass-approvals-and-sandbox (auto)
  //       claude flag: --permission-mode (auto | plan | default)
  const approvalModeByCli = useIDE((s) => s.approvalModeByCli);
  const setApprovalMode = useIDE((s) => s.setApprovalMode);

  const mode = approvalModeByCli[cli] ?? "confirm";
  const current = MODES.find((m) => m.id === mode) ?? MODES[1];
  const { Icon } = current;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="approval-pill"
          className="flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon className="h-3 w-3" />
          <span>{current.label}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="px-2 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Approval mode
        </div>
        {MODES.map((m) => {
          const active = m.id === mode;
          const { Icon: MIcon } = m;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setApprovalMode(cli, m.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent",
                active && "bg-accent/60",
              )}
            >
              <MIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div>
                <span className="font-mono text-[12.5px] text-foreground">{m.label}</span>
                <p className="text-[11px] text-muted-foreground">{m.description}</p>
              </div>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
