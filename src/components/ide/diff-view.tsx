import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Parsing ───────────────────────────────────────────────────────────────────

interface HunkLine {
  kind: "add" | "del" | "ctx" | "no-newline";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

interface Hunk {
  header: string;
  lines: HunkLine[];
}

interface FileDiff {
  fromFile: string;
  toFile: string;
  additions: number;
  deletions: number;
  hunks: Hunk[];
}

function parseHunkHeader(header: string): { oldStart: number; newStart: number } {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return { oldStart: m ? parseInt(m[1], 10) : 1, newStart: m ? parseInt(m[2], 10) : 1 };
}

function parseFileDiffs(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileBlocks = patch.split(/^(?=diff --git )/m).filter(Boolean);

  for (const block of fileBlocks) {
    const lines = block.split("\n");

    const fromLine = lines.find((l) => l.startsWith("--- ")) ?? "--- a/unknown";
    const toLine = lines.find((l) => l.startsWith("+++ ")) ?? "+++ b/unknown";
    const fromFile = fromLine.replace(/^--- (a\/)?/, "");
    const toFile = toLine.replace(/^\+\+\+ (b\/)?/, "");

    const hunkBlocks = block.split(/^(?=@@ )/m).slice(1);
    let additions = 0;
    let deletions = 0;
    const hunks: Hunk[] = [];

    for (const hunk of hunkBlocks) {
      const hunkLines = hunk.split("\n");
      const header = hunkLines[0];
      const { oldStart, newStart } = parseHunkHeader(header);
      let oldNo = oldStart;
      let newNo = newStart;
      const parsed: HunkLine[] = [];

      for (const raw of hunkLines.slice(1)) {
        if (raw === "") continue;
        const prefix = raw[0];
        const text = raw.slice(1);

        if (prefix === "+") {
          parsed.push({ kind: "add", text, oldNo: null, newNo: newNo++ });
          additions++;
        } else if (prefix === "-") {
          parsed.push({ kind: "del", text, oldNo: oldNo++, newNo: null });
          deletions++;
        } else if (prefix === "\\") {
          parsed.push({ kind: "no-newline", text: raw, oldNo: null, newNo: null });
        } else {
          parsed.push({ kind: "ctx", text, oldNo: oldNo++, newNo: newNo++ });
        }
      }

      if (parsed.length > 0) hunks.push({ header, lines: parsed });
    }

    if (hunks.length > 0) {
      files.push({ fromFile, toFile, additions, deletions, hunks });
    }
  }

  return files;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LineNo({ n }: { n: number | null }) {
  return (
    <span className="inline-block w-10 select-none text-right pr-2 text-[11px] text-muted-foreground/50 shrink-0">
      {n ?? ""}
    </span>
  );
}

function HunkView({ hunk }: { hunk: Hunk }) {
  return (
    <div className="font-mono text-[13px] leading-5">
      <div className="px-2 py-0.5 text-muted-foreground/60 text-[12px] bg-muted/20 select-none">
        {hunk.header}
      </div>
      {hunk.lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start px-1",
            line.kind === "add" && "bg-green-500/10",
            line.kind === "del" && "bg-red-500/10",
            line.kind === "no-newline" && "text-muted-foreground/50 italic",
          )}
        >
          <LineNo n={line.oldNo} />
          <LineNo n={line.newNo} />
          <span
            className={cn(
              "mr-1 select-none w-3 shrink-0",
              line.kind === "add" && "text-green-500",
              line.kind === "del" && "text-red-500",
            )}
          >
            {line.kind === "add" ? "+" : line.kind === "del" ? "-" : line.kind === "no-newline" ? "" : " "}
          </span>
          <span className="whitespace-pre-wrap break-all min-w-0">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

function FileDiffView({ file }: { file: FileDiff }) {
  const [open, setOpen] = useState(true);
  const name = file.toFile !== "/dev/null" ? file.toFile : file.fromFile;

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 truncate font-mono text-[13px]">{name}</span>
        {file.additions > 0 && (
          <Badge variant="outline" className="text-green-500 border-green-500/30 text-[11px] px-1.5 py-0">
            +{file.additions}
          </Badge>
        )}
        {file.deletions > 0 && (
          <Badge variant="outline" className="text-red-500 border-red-500/30 text-[11px] px-1.5 py-0">
            -{file.deletions}
          </Badge>
        )}
      </button>
      {open && (
        <div className="divide-y divide-border/50">
          {file.hunks.map((hunk, i) => (
            <HunkView key={i} hunk={hunk} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DiffViewProps {
  patch: string;
  className?: string;
}

export function DiffView({ patch, className }: DiffViewProps) {
  const files = parseFileDiffs(patch);

  if (files.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>No changes to display.</p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {files.map((file, i) => (
        <FileDiffView key={i} file={file} />
      ))}
    </div>
  );
}
