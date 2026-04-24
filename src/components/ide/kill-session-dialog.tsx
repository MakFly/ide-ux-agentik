import type { ReactNode } from "react";
import { useIDE, type WorkspaceTerminal } from "@/store/ide";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CLI_LABELS: Record<WorkspaceTerminal["kind"], string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
  gemini: "Gemini",
};

export function KillSessionDialog({
  session,
  trigger,
}: {
  session: WorkspaceTerminal;
  trigger: ReactNode;
}) {
  const closeAgentSession = useIDE((s) => s.closeAgentSession);
  const label = CLI_LABELS[session.kind];

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kill {label} session?</AlertDialogTitle>
          <AlertDialogDescription>
            This closes the running process and removes the tab. Persisted chat history stays in the
            database — reopening a session with the same id would restore the transcript.
            <br />
            <span className="mt-2 block font-mono text-[11.5px] text-muted-foreground">
              {session.title || label} · {session.id}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() => closeAgentSession(session.id)}
          >
            Kill session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
