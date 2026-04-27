import * as React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { FileText, Folder, Search } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIDE } from "@/store/ide";
import { providerFor, type FsEntry } from "@/lib/fs";
import { MOCK_ENABLED } from "@/lib/env";

export type FileMentionPopoverProps = {
  anchorRef: React.RefObject<HTMLElement | null>;
  query: string;
  onPick: (path: string) => void;
  onClose: () => void;
};

const MAX_INDEXED_ENTRIES = 5_000;
const MAX_DEPTH = 12;
const MAX_VISIBLE = 18;
const DEBOUNCE_MS = 100;
const SKIP_DIRS = new Set([
  ".git",
  ".multica",
  ".next",
  ".turbo",
  ".wrangler",
  "dist",
  "build",
  "coverage",
  "node_modules",
  "test-results",
]);

type MentionEntry = {
  path: string;
  type: FsEntry["type"];
};

type ScoredMentionEntry = MentionEntry & {
  score: number;
};

function joinWorkspaceProviderPath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/\/+$/, "");
  const relative = relativePath.replace(/^\/+/, "");
  return relative ? `${root}/${relative}` : root;
}

function relativePathFromRoot(rootPath: string, providerPath: string): string {
  const root = rootPath.replace(/\/+$/, "");
  if (providerPath === root) return "";
  if (providerPath.startsWith(`${root}/`)) return providerPath.slice(root.length + 1);
  return providerPath;
}

async function collectEntries(
  list: (path: string) => Promise<FsEntry[]>,
  path: string,
  depth: number,
  acc: MentionEntry[],
): Promise<void> {
  const queue: Array<{ path: string; depth: number }> = [{ path, depth }];
  while (queue.length > 0 && acc.length < MAX_INDEXED_ENTRIES) {
    const current = queue.shift()!;
    if (current.depth > MAX_DEPTH) continue;

    let entries: FsEntry[];
    try {
      entries = await list(current.path);
    } catch {
      continue;
    }

    for (const e of entries) {
      if (acc.length >= MAX_INDEXED_ENTRIES) break;
      if (!e.path || SKIP_DIRS.has(e.name)) continue;
      acc.push({ path: e.path, type: e.type });
      if (e.type === "directory") {
        queue.push({ path: e.path, depth: current.depth + 1 });
      }
    }
  }
}

function fuzzyIndex(path: string, query: string): number {
  const lower = path.replaceAll("/", " ").toLowerCase();
  const q = query.toLowerCase().replaceAll("/", " ").trim();
  if (!q) return 0;
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < lower.length && qi < q.length; i += 1) {
    if (lower[i] === q[qi]) qi++;
    if (lower[i] === q[qi - 1]) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (qi !== q.length) return -1;
  return Math.max(0, last - first);
}

function scoreEntry(entry: MentionEntry, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return entry.type === "directory" ? 1 : 2;

  const path = entry.path.toLowerCase();
  const base = path.split("/").pop() ?? path;
  const fuzzySpan = fuzzyIndex(path, q);
  if (fuzzySpan < 0) return Number.POSITIVE_INFINITY;

  let score = 100 + fuzzySpan;
  if (path === q) score -= 90;
  if (base === q) score -= 80;
  if (path.startsWith(q)) score -= 50;
  if (base.startsWith(q)) score -= 45;
  if (path.includes(`/${q}`)) score -= 25;
  if (entry.type === "directory") score -= 5;
  score += path.split("/").length;
  return score;
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

  const [allEntries, setAllEntries] = useState<MentionEntry[]>([]);
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
    if (!ws || (ws.source.kind === "mock" && !MOCK_ENABLED)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    providerFor(ws.source, ws.name)
      .then(async (provider) => {
        const acc: MentionEntry[] = [];
        await collectEntries(
          async (p) => {
            const providerPath =
              ws.source.kind === "remote-agent" && ws.rootPath
                ? joinWorkspaceProviderPath(ws.rootPath, p)
                : p;
            const entries = await provider.list(providerPath);
            if (ws.source.kind !== "remote-agent" || !ws.rootPath) return entries;
            return entries.map((entry) => ({
              ...entry,
              path: relativePathFromRoot(ws.rootPath!, entry.path),
            }));
          },
          "",
          0,
          acc,
        );
        if (!cancelled) {
          setAllEntries(acc);
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

  const filtered = React.useMemo(() => {
    const scored: ScoredMentionEntry[] = [];
    for (const entry of allEntries) {
      const score = scoreEntry(entry, debouncedQuery);
      if (Number.isFinite(score)) scored.push({ ...entry, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
      .slice(0, MAX_VISIBLE);
  }, [allEntries, debouncedQuery]);

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
        const entry = filtered[activeIndex];
        if (entry) onPick(entry.type === "directory" ? `${entry.path}/` : entry.path);
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
        className="w-[30rem] max-w-[calc(100vw-2rem)] p-1 max-h-[340px] flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={onClose}
      >
        <div className="flex items-center gap-2 border-b px-2 py-1.5 text-[11px] text-muted-foreground">
          <Search className="size-3.5" />
          <span>
            {loading
              ? "Indexing workspace files..."
              : `${allEntries.length} indexed files and folders`}
          </span>
        </div>
        <div
          ref={listRef}
          className="overflow-y-auto flex flex-col gap-0.5 pt-1"
          style={{ maxHeight: 300 }}
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
              No files or folders found
            </div>
          ) : (
            filtered.map((entry, i) => {
              const pickPath = entry.type === "directory" ? `${entry.path}/` : entry.path;
              const slash = entry.path.lastIndexOf("/");
              const dir = slash >= 0 ? entry.path.slice(0, slash + 1) : "";
              const base = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
              const Icon = entry.type === "directory" ? Folder : FileText;
              return (
                <div
                  key={`${entry.type}:${entry.path}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm select-none",
                    i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => onPick(pickPath)}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      entry.type === "directory" ? "text-amber-500" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {dir && (
                      <span
                        className={cn(
                          "text-muted-foreground",
                          i === activeIndex && "text-accent-foreground/70",
                        )}
                      >
                        {highlightMatch(dir, debouncedQuery)}
                      </span>
                    )}
                    <span className="text-foreground">
                      {highlightMatch(base, debouncedQuery)}
                      {entry.type === "directory" ? "/" : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground",
                      i === activeIndex && "border-accent-foreground/30 text-accent-foreground/70",
                    )}
                  >
                    {entry.type === "directory" ? "dir" : "file"}
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
