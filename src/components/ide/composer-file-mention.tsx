import * as React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { FileText } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIDE } from "@/store/ide";
import { providerFor, type FsEntry } from "@/lib/fs";

export type FileMentionPopoverProps = {
  anchorRef: React.RefObject<HTMLElement | null>;
  query: string;
  onPick: (path: string) => void;
  onClose: () => void;
};

const MAX_FILES = 500;
const MAX_DEPTH = 8;
const MAX_VISIBLE = 15;
const DEBOUNCE_MS = 100;

async function collectFiles(
  list: (path: string) => Promise<FsEntry[]>,
  path: string,
  depth: number,
  acc: string[],
): Promise<void> {
  if (depth > MAX_DEPTH || acc.length >= MAX_FILES) return;
  let entries: FsEntry[];
  try {
    entries = await list(path);
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) break;
    if (e.type === "file") {
      acc.push(e.path);
    } else if (e.type === "directory") {
      await collectFiles(list, e.path, depth + 1, acc);
    }
  }
}

function fuzzyMatch(path: string, query: string): boolean {
  if (!query) return true;
  const lower = path.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let ti = 0;
  let qi = 0;
  const matchPositions: number[] = [];
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      matchPositions.push(i);
      qi++;
    }
  }
  const matchSet = new Set(matchPositions);
  for (let i = 0; i < text.length; i++) {
    if (matchSet.has(i)) {
      if (ti < i) parts.push(text.slice(ti, i));
      parts.push(
        <span key={i} className="text-foreground font-semibold">
          {text[i]}
        </span>,
      );
      ti = i + 1;
    }
  }
  if (ti < text.length) parts.push(text.slice(ti));
  return parts;
}

export function FileMentionPopover({ anchorRef, query, onPick, onClose }: FileMentionPopoverProps) {
  const workspaces = useIDE((s) => s.workspaces);
  const activeWorkspaceId = useIDE((s) => s.activeWorkspaceId);

  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!ws) {
      setLoading(false);
      return;
    }
    setLoading(true);
    providerFor(ws.source, ws.name)
      .then(async (provider) => {
        const acc: string[] = [];
        await collectFiles((p) => provider.list(p), "", 0, acc);
        if (!cancelled) {
          setAllFiles(acc);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaces, activeWorkspaceId]);

  const filtered = React.useMemo(
    () => allFiles.filter((p) => fuzzyMatch(p, debouncedQuery)).slice(0, MAX_VISIBLE),
    [allFiles, debouncedQuery],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[activeIndex]) onPick(filtered[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, activeIndex, onPick, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  return (
    <Popover open>
      <PopoverAnchor virtualRef={anchorRef as React.RefObject<Element>} />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-96 p-1 max-h-[280px] flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={onClose}
      >
        <div
          ref={listRef}
          className="overflow-y-auto flex flex-col gap-0.5"
          style={{ maxHeight: 260 }}
        >
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-3 w-48 rounded" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              No files found
            </div>
          ) : (
            filtered.map((path, i) => {
              const slash = path.lastIndexOf("/");
              const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
              const base = slash >= 0 ? path.slice(slash + 1) : path;
              return (
                <div
                  key={path}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer text-sm select-none",
                    i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => onPick(path)}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate min-w-0">
                    {dir && <span className="text-muted-foreground">{dir}</span>}
                    <span className="text-foreground">{highlightMatch(base, debouncedQuery)}</span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
