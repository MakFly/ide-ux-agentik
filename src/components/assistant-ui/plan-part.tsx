"use client";

/**
 * PlanStepList — renders a structured plan emitted by Codex via `plan_update`
 * events OR promoted from a markdown response by codex/claude-adapter's
 * parsePlanMarkdown.
 *
 * Codex native event shape (openai/codex-rs/tools/src/plan_tool.rs):
 *   { type: "item.updated", item: { type: "plan_update", explanation?: string,
 *     plan: PlanStep[] } }
 *
 * Markdown-promoted shape (plan-mode.ts parsePlanMarkdown):
 *   { title?, explanation?, steps: PlanStep[], followUps?: string[] }
 *
 * Mapped by codex/claude-adapter.ts to a tool-call part with toolName "plan".
 * Dispatched to this component by tool-fallback.tsx:254.
 *
 * UI actions:
 *   - Approve & execute → injects "approve" prompt into composer
 *   - Refine → opens a modal with split markdown editor + live preview
 *   - Discard → hides the plan from the conversation (local React state only,
 *     the original is preserved in the persisted message parts)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ListTodo,
  LoaderCircle,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAssistantRuntime } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { parsePlanMarkdown, setPlanModeForCli } from "@/lib/chat/plan-mode";
import { useIDE, type TerminalKind } from "@/store/ide";

export type PlanStep = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

export type PlanArgs = {
  title?: string;
  explanation?: string;
  steps: PlanStep[];
  followUps?: string[];
};

function StepIcon({ status }: { status: PlanStep["status"] }) {
  if (status === "completed") return <CheckCircle2 className="size-4 shrink-0 text-green-500" />;
  if (status === "in_progress")
    return <LoaderCircle className="size-4 shrink-0 animate-spin text-blue-500" />;
  return <Circle className="size-4 shrink-0 text-muted-foreground/50" />;
}

// ---------------------------------------------------------------------------
// Discard persistence
// ---------------------------------------------------------------------------
// Discards survive a refresh via localStorage. We key on a stable hash of the
// plan's *content* (title + steps) rather than a tool-call id because the
// tool-call id changes between live (`plan:msg:N:i`) and restored
// (`restored-${msg.id}-N`) contexts. Same plan content = same hash = same
// discard state across both.

const DISCARD_LS_KEY = "ide-ux-agentik:plan-discards";
const APPROVED_LS_KEY = "ide-ux-agentik:plan-approvals";

function planContentHash(args: PlanArgs): string {
  const canonical = JSON.stringify({
    t: args.title ?? "",
    e: args.explanation ?? "",
    s: args.steps?.map((s) => `${s.status}:${s.step}`) ?? [],
    f: args.followUps ?? [],
  });
  // djb2 — fast, deterministic, sufficient collision-resistance for this use.
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) {
    h = ((h << 5) + h + canonical.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function readDiscardSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DISCARD_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function persistDiscard(hash: string, on: boolean) {
  const set = readDiscardSet();
  if (on) set.add(hash);
  else set.delete(hash);
  try {
    localStorage.setItem(DISCARD_LS_KEY, JSON.stringify([...set]));
  } catch {
    /* quota or disabled — silently degrade to in-session-only */
  }
}

function readApprovedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(APPROVED_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function persistApproved(hash: string, on: boolean) {
  const set = readApprovedSet();
  if (on) set.add(hash);
  else set.delete(hash);
  try {
    localStorage.setItem(APPROVED_LS_KEY, JSON.stringify([...set]));
  } catch {
    /* quota or disabled — silently degrade to in-session-only */
  }
}

/** Reverse of parsePlanMarkdown: serialize a structured plan back to the
 *  hardened markdown format so it round-trips through the editor. */
function planToMarkdown(args: PlanArgs): string {
  const lines: string[] = [];
  lines.push(`## Plan${args.title ? `: ${args.title}` : ""}`);
  if (args.explanation) {
    lines.push("");
    lines.push(args.explanation);
  }
  lines.push("");
  for (const s of args.steps) {
    const marker = s.status === "completed" ? "x" : s.status === "in_progress" ? "~" : " ";
    lines.push(`- [${marker}] ${s.step}`);
  }
  if (args.followUps && args.followUps.length > 0) {
    lines.push("");
    lines.push("## Follow-up");
    for (const f of args.followUps) lines.push(`- ${f}`);
  }
  return lines.join("\n");
}

function approvalPrompt(args: PlanArgs): string {
  return [
    "Approve the plan above and execute the approved plan to completion.",
    "",
    "## Exited Plan Mode",
    "",
    "You have exited plan mode. You can now make edits, run tools, and take actions.",
    "",
    "Execution instructions:",
    "- Exit plan mode now. Do not produce another plan unless execution is blocked.",
    "- Execute every pending step in the approved plan, not only step 1.",
    "- Use the approved plan below as the source of truth and report what was completed.",
    "",
    "Approved plan:",
    planToMarkdown(args),
  ].join("\n");
}

// Window during which Discard can be undone via the inline placeholder. After
// this elapses, the placeholder fades and the plan is gone for the session.
const UNDO_WINDOW_MS = 6000;

export const PlanStepList: ToolCallMessagePartComponent = ({ args }) => {
  const runtime = useAssistantRuntime();
  const activeCli = useIDE((s) => {
    const activeThread = s.selectActiveAgentThread(s.activeWorkspaceId);
    if (activeThread?.cli) return activeThread.cli;
    const composerAgent = s.composerAgentByWorkspaceId[s.activeWorkspaceId];
    if (composerAgent) return composerAgent;
    const sessions = s.sessionsByWorkspaceId[s.activeWorkspaceId] ?? [];
    const activeId = s.activeSessionIdByWorkspaceId[s.activeWorkspaceId];
    return sessions.find((t) => t.id === activeId)?.kind ?? s.activeAgent;
  }) as TerminalKind;
  const original = (args ?? {}) as PlanArgs;

  const [override, setOverride] = useState<PlanArgs | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const current: PlanArgs = override ?? original;
  const { title, explanation, steps = [], followUps = [] } = current;
  const hash = useMemo(() => planContentHash(current), [current]);

  // Discard state: "active" (visible), "undoable" (placeholder, can undo),
  // "gone" (collapsed to null). On mount, hydrate from localStorage so a
  // previously-discarded plan stays discarded across refreshes.
  const [phase, setPhase] = useState<"active" | "approved" | "undoable" | "gone">(() => {
    if (typeof window === "undefined") return "active";
    if (readDiscardSet().has(hash)) return "gone";
    if (readApprovedSet().has(hash)) return "approved";
    return "active";
  });
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If hash changes (Refine produced new content), reset to active.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readDiscardSet().has(hash)) setPhase("gone");
    else if (readApprovedSet().has(hash)) setPhase("approved");
    else setPhase("active");
  }, [hash]);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  const { done, total, pct } = useMemo(() => {
    const t = steps.length;
    const d = steps.filter((s) => s.status === "completed").length;
    return { done: d, total: t, pct: t === 0 ? 0 : Math.round((d / t) * 100) };
  }, [steps]);

  function setComposer(text: string) {
    try {
      runtime.thread.composer.setText(text);
    } catch (e) {
      console.warn("[plan] composer.setText failed:", e);
    }
  }

  async function approveAndExecute() {
    const text = approvalPrompt(current);
    setApproving(true);
    try {
      setPlanModeForCli(activeCli, false);
      runtime.thread.composer.setText(text);
      await runtime.thread.composer.send();
      persistApproved(hash, true);
      setPhase("approved");
    } catch (e) {
      console.warn("[plan] composer.send failed:", e);
      setComposer(text);
    } finally {
      setApproving(false);
    }
  }

  function commitDiscard() {
    setConfirmOpen(false);
    persistDiscard(hash, true);
    setPhase("undoable");
    undoTimer.current = setTimeout(() => setPhase("gone"), UNDO_WINDOW_MS);
  }

  function undoDiscard() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    persistDiscard(hash, false);
    setPhase("active");
  }

  if (phase === "gone") return null;

  if (phase === "undoable") {
    return (
      <div className="my-1 flex items-center gap-3 rounded-md border border-dashed bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
        <Trash2 className="size-4 shrink-0" />
        <span className="flex-1 truncate">
          Plan discarded
          {title && <span className="font-medium"> · {title}</span>}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-foreground"
          onClick={undoDiscard}
        >
          <RotateCcw className="size-3.5" />
          Undo
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="my-1 w-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <ListTodo className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">
            {title ? `Plan · ${title}` : "Plan"}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {done}/{total}
          </span>
        </div>

        {/* Progress bar */}
        {total > 0 && <Progress value={pct} className="h-1 rounded-none" />}

        {/* Explanation */}
        {explanation && (
          <p className="px-4 pt-3 text-[13px] leading-5 text-muted-foreground">{explanation}</p>
        )}

        {/* Steps */}
        <ul className="flex flex-col gap-1 px-4 py-3">
          {steps.map((s, i) => (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2.5 text-sm leading-5",
                s.status === "completed" && "text-muted-foreground line-through",
              )}
            >
              <StepIcon status={s.status} />
              <span>{s.step}</span>
            </li>
          ))}
        </ul>

        {/* Action bar */}
        {phase === "approved" ? (
          <div className="flex items-center gap-2 border-t bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="font-medium">Plan approved</span>
            <span className="text-muted-foreground">Execution started; plan mode is off.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={approving}
              onClick={() => void approveAndExecute()}
            >
              <Play className="size-3.5" />
              {approving ? "Approving..." : "Approve & execute"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={approving}
              onClick={() => setRefineOpen(true)}
            >
              <Pencil className="size-3.5" />
              Refine
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
              disabled={approving}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="size-3.5" />
              Discard
            </Button>
          </div>
        )}

        {/* Follow-up suggestions */}
        {phase !== "approved" && followUps.length > 0 && (
          <div className="border-t px-4 py-2.5">
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Follow-up suggestions
            </div>
            <div className="flex flex-wrap gap-1.5">
              {followUps.map((f, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  className="h-7 justify-start gap-1.5 whitespace-normal text-left text-[12px] font-normal"
                  onClick={() => setComposer(f)}
                  title={f}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <RefineDialog
        open={refineOpen}
        onClose={() => setRefineOpen(false)}
        initial={current}
        onSave={(next) => {
          setOverride(next);
          setRefineOpen(false);
        }}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this plan?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan{title && <> &laquo;&nbsp;{title}&nbsp;&raquo;</>} will be removed from this
              conversation. You&apos;ll have a few seconds to undo before it&apos;s gone for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={commitDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

PlanStepList.displayName = "PlanStepList";

// ---------------------------------------------------------------------------
// Refine dialog — split markdown editor + live preview
// ---------------------------------------------------------------------------

interface RefineDialogProps {
  open: boolean;
  onClose: () => void;
  initial: PlanArgs;
  onSave: (next: PlanArgs) => void;
}

function RefineDialog({ open, onClose, initial, onSave }: RefineDialogProps) {
  // Initialise the textarea with the current plan as markdown. Keyed on the
  // initial reference so re-opening the dialog after a save shows the updated
  // version.
  const initialMarkdown = useMemo(() => planToMarkdown(initial), [initial]);
  const [markdown, setMarkdown] = useState(initialMarkdown);

  // Re-sync textarea when `open` flips from false → true (so that closing
  // without saving and re-opening shows the latest saved state, not stale text).
  const [openTracker, setOpenTracker] = useState(open);
  if (open !== openTracker) {
    setOpenTracker(open);
    if (open) setMarkdown(initialMarkdown);
  }

  function handleSave() {
    const parsed = parsePlanMarkdown(markdown);
    if (!parsed) {
      // Markdown didn't parse — keep dialog open so the user can fix it.
      // A small inline error would be nicer; v1 just logs.
      console.warn("[plan/refine] markdown didn't parse — expected `## Plan` + `- [ ]` lines");
      return;
    }
    onSave({
      title: parsed.title,
      explanation: parsed.explanation,
      steps: parsed.steps,
      followUps: parsed.followUps,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="flex h-[85vh] max-h-[900px] w-[95vw] max-w-6xl flex-col gap-3 p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pencil className="size-4" />
            Refine plan
          </DialogTitle>
          <DialogDescription className="text-xs">
            Edit the markdown on the left — the preview updates live. Steps must start with
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">- [ ]</code>
            (or{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">[x]</code>
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">[~]</code>).
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden px-5 md:grid-cols-2">
          {/* Editor */}
          <div className="flex min-h-0 flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Markdown
            </span>
            <Textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              className="min-h-0 flex-1 resize-none font-mono text-[12.5px] leading-relaxed"
              spellCheck={false}
            />
          </div>

          {/* Preview */}
          <div className="flex min-h-0 flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Preview
            </span>
            <div className="prose prose-sm dark:prose-invert min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20 px-4 py-3 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_li]:my-0.5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:ml-4 [&_ul]:list-disc">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t bg-muted/30 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
