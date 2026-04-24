import { useEffect, useState } from "react";
import { GitBranchPlus, GitCommitHorizontal, GitCompare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DiffView } from "@/components/ide/diff-view";
import { gitClient, type GitFileEntry } from "@/lib/git/client";

const btnClass =
  "inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 transition-colors";

interface GitActionsProps {
  disabled?: boolean;
}

function ActionTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function StageButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [staging, setStaging] = useState(false);
  const [files, setFiles] = useState<GitFileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadStatus = async () => {
    setLoading(true);
    try {
      const result = await gitClient.status();
      const unstaged = result.files.filter((f) => f.unstaged || f.kind === "untracked");
      setFiles(unstaged);
      setSelected(new Set(unstaged.map((f) => f.path)));
    } catch (e) {
      toast.error(`git status failed: ${e instanceof Error ? e.message : String(e)}`);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) loadStatus();
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleStage = async () => {
    const paths = Array.from(selected);
    if (paths.length === 0) return;
    setStaging(true);
    try {
      await gitClient.stage(paths);
      toast.success(`Staged ${paths.length} file${paths.length > 1 ? "s" : ""}`);
      setOpen(false);
    } catch (e) {
      toast.error(`git add failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStaging(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <ActionTooltip label="Stage changes">
        <PopoverTrigger asChild>
          <button className={btnClass} disabled={disabled}>
            <GitBranchPlus className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Stage</span>
          </button>
        </PopoverTrigger>
      </ActionTooltip>
      <PopoverContent align="end" className="w-72 p-3">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-xs text-muted-foreground">No unstaged changes.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">Select files to stage</p>
            <ul className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {files.map((f) => (
                <li key={f.path} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`stage-${f.path}`}
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    className="h-3 w-3 shrink-0"
                  />
                  <label
                    htmlFor={`stage-${f.path}`}
                    className="truncate text-xs font-mono cursor-pointer"
                    title={f.path}
                  >
                    {f.path}
                  </label>
                </li>
              ))}
            </ul>
            <button
              onClick={handleStage}
              disabled={selected.size === 0 || staging}
              className="self-end rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {staging ? <Loader2 className="h-3 w-3 animate-spin" /> : `Stage ${selected.size}`}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CommitButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [stagedCount, setStagedCount] = useState<number | null>(null);

  const checkStaged = async () => {
    try {
      const result = await gitClient.status();
      setStagedCount(result.files.filter((f) => f.staged).length);
    } catch {
      setStagedCount(null);
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) checkStaged();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    try {
      const result = await gitClient.commit(message.trim());
      toast.success(`Committed ${result.sha ? result.sha.slice(0, 7) : ""}`, {
        description: result.message,
      });
      setMessage("");
      setOpen(false);
    } catch (e) {
      toast.error(`git commit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const noStaged = stagedCount !== null && stagedCount === 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <ActionTooltip label="Commit staged changes">
        <PopoverTrigger asChild>
          <button className={btnClass} disabled={disabled}>
            <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Commit</span>
          </button>
        </PopoverTrigger>
      </ActionTooltip>
      <PopoverContent align="end" className="w-72 p-3">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <p className="text-xs font-medium">Commit message</p>
          {noStaged && (
            <p className="text-xs text-amber-500">No staged files — stage changes first.</p>
          )}
          <textarea
            className="min-h-[72px] w-full resize-none rounded border border-input bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            placeholder="feat: describe your change…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            autoFocus
            disabled={noStaged}
          />
          <button
            type="submit"
            disabled={!message.trim() || loading || noStaged}
            className="self-end rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            Commit
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function DiffButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [patch, setPatch] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const loadDiff = async () => {
    setLoading(true);
    setPatch("");
    try {
      const result = await gitClient.diff(false);
      setPatch(result.patch);
    } catch (e) {
      toast.error(`git diff failed: ${e instanceof Error ? e.message : String(e)}`);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) loadDiff();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ActionTooltip label="View diff">
        <DialogTrigger asChild>
          <button className={btnClass} disabled={disabled}>
            <GitCompare className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Diff</span>
          </button>
        </DialogTrigger>
      </ActionTooltip>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Working tree diff</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : patch ? (
          <DiffView patch={patch} />
        ) : (
          <p className="text-xs text-muted-foreground py-4">No unstaged changes.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function GitActions({ disabled }: GitActionsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <StageButton disabled={disabled} />
      <CommitButton disabled={disabled} />
      <DiffButton disabled={disabled} />
    </div>
  );
}
