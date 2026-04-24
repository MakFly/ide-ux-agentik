import type { ReactNode } from "react";
import { toast } from "sonner";
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
import { providerFor } from "@/lib/fs";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import { persistence } from "@/lib/persistence/client";

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

  async function kill() {
    const { workspaces } = useIDE.getState();
    const ws = workspaces.find((w) => w.id === session.workspaceId);
    if (ws && ws.source.kind === "remote-agent") {
      try {
        const provider = (await providerFor(ws.source, ws.source.label)) as RemoteAgentProvider;
        await provider.connect();
        await persistence.sessions.delete(provider, session.id);
        console.debug("[persistence] session deleted", session.id);
      } catch (e) {
        console.warn("[persistence] sessions.delete failed", session.id, e);
        toast.error("Failed to delete session from database — removed locally only.");
      }
    }
    closeAgentSession(session.id);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kill {label} session?</AlertDialogTitle>
          <AlertDialogDescription>
            Closes the running process, removes the tab, and deletes the transcript from the
            database. Cascades to all messages and file snapshots for this session. This cannot be
            undone.
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
            onClick={() => void kill()}
          >
            Kill session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
