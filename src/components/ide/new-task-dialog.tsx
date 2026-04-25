import { useEffect, useMemo, useRef, useState, type FC, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Send, Sparkles, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIDE, type TerminalKind, type Workspace } from "@/store/ide";
import { RemoteAgentProvider } from "@/lib/fs/remote-agent";
import {
  CODEX_MODELS,
  CLAUDE_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CLAUDE_MODEL,
} from "@/lib/chat/models";

const SUPPORTED_CLIS: { value: TerminalKind; label: string; hint: string }[] = [
  { value: "codex", label: "Codex", hint: "OpenAI · GPT-5 / o-series" },
  { value: "claude", label: "Claude", hint: "Anthropic · Sonnet / Opus" },
];

type Effort = { value: string; label: string };

const EFFORTS_BY_CLI: Record<string, Effort[]> = {
  codex: [
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Xhigh" },
  ],
  claude: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Xhigh" },
    { value: "max", label: "Max" },
  ],
};

const DEFAULT_EFFORT_BY_CLI: Record<TerminalKind, string> = {
  codex: "medium",
  claude: "high",
  opencode: "medium",
  gemini: "medium",
};

const DEFAULT_MODEL_BY_CLI: Record<TerminalKind, string> = {
  codex: DEFAULT_CODEX_MODEL,
  claude: DEFAULT_CLAUDE_MODEL,
  opencode: "default",
  gemini: "gemini-2.5-pro",
};

function modelsFor(cli: TerminalKind) {
  if (cli === "codex") return CODEX_MODELS;
  if (cli === "claude") return CLAUDE_MODELS;
  return [];
}

const EXAMPLE_PROMPTS: { label: string; title: string; body: string }[] = [
  {
    label: "Hello world (Python)",
    title: "Hello world in Python",
    body: 'Create a `hello.py` script at the repo root that prints "Hello, world!" when executed with `python hello.py`. Add a one-line README note describing how to run it.',
  },
  {
    label: "README skeleton",
    title: "Add a project README",
    body: "Generate a concise `README.md` with these sections: project name, what it does in 2 sentences, install steps (`bun install` + `make dev`), how to run tests, and where the docs live.",
  },
  {
    label: "Refactor: rename function",
    title: "Refactor `getUser` → `fetchUser`",
    body: "Search the codebase for any reference to a function called `getUser` (declarations, calls, type annotations) and rename it to `fetchUser`. Keep the behavior identical, just rename. Update tests and documentation accordingly.",
  },
  {
    label: "Bug hunt: file tree",
    title: "Investigate the files panel race",
    body: "Investigate why the right-side Files panel sometimes shows an empty list right after page refresh. The fix likely lives near `loadRoot`/`hydrate`. Reproduce, identify the race, propose a fix in 5 bullet points — do not modify code yet.",
  },
  {
    label: "Add unit tests",
    title: "Cover the slug-validator with tests",
    body: "Find the slug validation utility used during workspace creation. Write Vitest unit tests covering: empty input, single-char, valid lowercase, uppercase rejected, special chars rejected, max length, leading/trailing dashes.",
  },
];

function pickRandomExample(currentPrompt: string) {
  const pool = EXAMPLE_PROMPTS.filter((e) => e.body.trim() !== currentPrompt.trim());
  return pool[Math.floor(Math.random() * pool.length)] ?? EXAMPLE_PROMPTS[0];
}

export const NewTaskDialog: FC<{
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ workspace, open, onOpenChange }) => {
  const defaultCli = useIDE((s) => s.activeAgent);
  const setActiveSession = useIDE((s) => s.setActiveSession);
  const setActiveAgent = useIDE((s) => s.setActiveAgent);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cli, setCli] = useState<TerminalKind>(defaultCli);
  const [model, setModel] = useState<string>(DEFAULT_MODEL_BY_CLI[defaultCli]);
  const [effort, setEffort] = useState<string>(DEFAULT_EFFORT_BY_CLI[defaultCli]);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const models = useMemo(() => modelsFor(cli), [cli]);
  const efforts = useMemo(() => EFFORTS_BY_CLI[cli] ?? [], [cli]);

  // Reset on open + when CLI changes pick the matching default model/effort.
  useEffect(() => {
    if (open) {
      setTitle("");
      setPrompt("");
      setCli(defaultCli);
      setModel(DEFAULT_MODEL_BY_CLI[defaultCli]);
      setEffort(DEFAULT_EFFORT_BY_CLI[defaultCli]);
      setBusy(false);
      setTimeout(() => promptRef.current?.focus(), 40);
    }
  }, [open, defaultCli]);

  // Realign model/effort when the user flips CLI.
  useEffect(() => {
    setModel((prev) => {
      const stillValid = modelsFor(cli).some((m) => m.id === prev);
      return stillValid ? prev : DEFAULT_MODEL_BY_CLI[cli];
    });
    setEffort((prev) => {
      const stillValid = (EFFORTS_BY_CLI[cli] ?? []).some((e) => e.value === prev);
      return stillValid ? prev : DEFAULT_EFFORT_BY_CLI[cli];
    });
  }, [cli]);

  const dispatch = async () => {
    const p = prompt.trim();
    if (!p) {
      toast.error("Compose your task first");
      promptRef.current?.focus();
      return;
    }
    if (workspace.source.kind !== "remote-agent") {
      toast.error("Active workspace is not a remote agent");
      return;
    }
    const finalTitle = title.trim() || p.split("\n")[0].slice(0, 60) || "Untitled task";
    setBusy(true);
    const t0 = performance.now();
    console.info(
      `[NewTaskDialog] dispatching ws=${workspace.id} cli=${cli} model=${model} effort=${effort} promptLen=${p.length}`,
    );
    try {
      const provider = new RemoteAgentProvider(
        workspace.source.label,
        workspace.source.url,
        workspace.source.token,
      );
      await provider.connect();
      const { id, sessionId } = await provider.taskCreate({
        workspaceId: workspace.id,
        title: finalTitle,
        prompt: p,
        cli,
        model,
        effort,
      });
      console.info(`[NewTaskDialog] taskCreate ok id=${id} sessionId=${sessionId}`);
      await provider.taskStart(id);
      console.info(
        `[NewTaskDialog] taskStart ok id=${id} (${Math.round(performance.now() - t0)}ms)`,
      );
      // Surface the freshly-spawned task as the active tab in <Workspace>.
      // upsertTask (via onTaskCreated broadcast) mirrors the session-tab; this
      // just selects it so the user lands on the transcript.
      setActiveSession(sessionId);
      setActiveAgent(cli);
      toast.success("Task dispatched");
      onOpenChange(false);
    } catch (err) {
      console.error("[NewTaskDialog] dispatch failed:", err);
      toast.error(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void dispatch();
    }
  };

  const fillExample = () => {
    const ex = pickRandomExample(prompt);
    setTitle(ex.title);
    setPrompt(ex.body);
    promptRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(92vw,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border bg-muted/40 px-5 py-3">
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              New agent task
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={fillExample}
              disabled={busy}
              className="gap-1"
              title="Fill with an example task"
            >
              <Wand2 className="h-3 w-3" />
              Example
            </Button>
          </div>
          <DialogDescription className="text-[12px]">
            Compose a prompt for the agent. The task runs async in its own git worktree with a fresh
            CLI session.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-task-title" className="text-[11px] uppercase tracking-wide">
              Title <span className="text-muted-foreground normal-case">(optional)</span>
            </Label>
            <Input
              id="new-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to the first line of the prompt"
              disabled={busy}
              className="h-9"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <Label htmlFor="new-task-prompt" className="text-[11px] uppercase tracking-wide">
              Prompt
            </Label>
            <Textarea
              id="new-task-prompt"
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Describe what the agent should do.&#10;&#10;⌘↵ to dispatch."
              disabled={busy}
              className="min-h-[160px] flex-1 resize-none font-sans text-[13px] leading-snug"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide">CLI</Label>
            <div className="grid grid-cols-2 gap-2">
              {SUPPORTED_CLIS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setCli(opt.value)}
                  disabled={busy}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    cli === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-accent/50",
                  )}
                >
                  <div className="text-[13px] font-semibold text-foreground">{opt.label}</div>
                  <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide">Model</Label>
              <Select value={model} onValueChange={setModel} disabled={busy || models.length === 0}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <div className="flex flex-col items-start py-0.5">
                        <span className="font-mono text-[12.5px]">{m.label}</span>
                        <span className="text-[10.5px] text-muted-foreground">{m.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide">Reasoning effort</Label>
              <Select
                value={effort}
                onValueChange={setEffort}
                disabled={busy || efforts.length === 0}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {efforts.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
          <div className="text-[11px] text-muted-foreground">
            Streams over WebSocket · runs in{" "}
            <span className="font-mono">.multica/tasks/&lt;id&gt;</span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void dispatch()}
              disabled={busy || !prompt.trim()}
              className="gap-1.5"
            >
              {busy ? (
                <span className="block h-3 w-3 animate-spin rounded-full border border-transparent border-t-current" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Dispatch task
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
