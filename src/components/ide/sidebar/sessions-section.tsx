import { Bot, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIDE, useCurrentSessions, useActiveSession, type WorkspaceTerminal } from "@/store/ide";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { KillSessionDialog } from "@/components/ide/kill-session-dialog";
import { SessionsSkeleton } from "@/components/ide/skeletons/sidebar-skeletons";

const CLI_LABELS: Record<WorkspaceTerminal["kind"], string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
  gemini: "Gemini",
};

function SessionStatusDot({ status }: { status: WorkspaceTerminal["status"] }) {
  if (status === "busy") {
    return <span className="block h-2 w-2 shrink-0 animate-pulse rounded-full bg-status-warn" />;
  }
  if (status === "idle") {
    return <span className="block h-2 w-2 shrink-0 rounded-full bg-status-add" />;
  }
  return <span className="block h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />;
}

function SessionRow({
  session,
  active,
  onSelect,
}: {
  session: WorkspaceTerminal;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        active ? "bg-branch-active" : "hover:bg-accent/50",
      )}
    >
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[12.5px] text-foreground">
              {session.title || CLI_LABELS[session.kind]}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
              {CLI_LABELS[session.kind]}
            </span>
          </div>
          {session.lastCommand && (
            <div className="mt-0.5 truncate pr-1 font-mono text-[11px] text-muted-foreground">
              {session.lastCommand}
            </div>
          )}
        </div>
      </button>
      <SessionStatusDot status={session.status} />
      <KillSessionDialog
        session={session}
        trigger={
          <button
            onClick={(e) => e.stopPropagation()}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
            title="Kill session"
          >
            <X className="h-3 w-3" />
          </button>
        }
      />
    </div>
  );
}

export function SessionsSection() {
  const sessions = useCurrentSessions();
  const activeSession = useActiveSession();
  const setActiveSession = useIDE((s) => s.setActiveSession);
  const sessionsLoading = useIDE((s) => s.sessionsLoading);
  const showSkeleton = sessionsLoading && sessions.length === 0;

  return (
    <AccordionItem value="sessions" className="border-b-0">
      <AccordionTrigger className="flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:no-underline hover:text-foreground">
        <span className="flex items-center gap-2">
          Sessions
          {showSkeleton ? (
            <span className="h-3 w-5 animate-pulse rounded bg-accent/60" />
          ) : (
            <span className="rounded bg-accent/60 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-foreground">
              {sessions.length}
            </span>
          )}
        </span>
      </AccordionTrigger>

      <AccordionContent className="pb-1 pt-0">
        {showSkeleton ? (
          <SessionsSkeleton />
        ) : (
          <div className="flex flex-col gap-0.5 px-1.5">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeSession?.id}
                onSelect={() => setActiveSession(session.id)}
              />
            ))}
            {sessions.length === 0 && (
              <div className="mx-1 rounded-md border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
                No sessions yet — start one from the CLI picker.
              </div>
            )}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
