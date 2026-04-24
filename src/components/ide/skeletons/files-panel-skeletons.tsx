import { Skeleton } from "@/components/ui/skeleton";

type Row = { kind: "folder" | "file"; width: string };

const FILE_TREE_ROWS: Row[] = [
  { kind: "folder", width: "w-20" },
  { kind: "file", width: "w-28" },
  { kind: "file", width: "w-24" },
  { kind: "file", width: "w-32" },
  { kind: "folder", width: "w-16" },
  { kind: "file", width: "w-20" },
  { kind: "file", width: "w-28" },
  { kind: "folder", width: "w-24" },
  { kind: "file", width: "w-24" },
  { kind: "file", width: "w-16" },
  { kind: "file", width: "w-28" },
  { kind: "folder", width: "w-20" },
];

export function FileTreeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading file tree">
      {FILE_TREE_ROWS.map((row, i) =>
        row.kind === "folder" ? (
          <div
            key={i}
            className="flex h-[22px] items-center gap-1.5 px-3 py-[3px]"
          >
            <Skeleton className="h-3 w-3" />
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <Skeleton className={`h-3 ${row.width}`} />
          </div>
        ) : (
          <div
            key={i}
            className="flex h-[22px] items-center gap-1.5 py-[3px] pl-[36px] pr-3"
          >
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <Skeleton className={`h-3 ${row.width}`} />
          </div>
        ),
      )}
    </div>
  );
}

export function ChangesSkeleton() {
  const widths = ["w-40", "w-32", "w-48"];
  return (
    <div
      className="space-y-2 px-4 py-3"
      aria-busy="true"
      aria-label="Loading changes"
    >
      {widths.map((w, i) => (
        <div key={i} className="flex h-6 items-center gap-2">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className={`h-3 ${w}`} />
          <Skeleton className="ml-auto h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export function ChecksSkeleton() {
  const widths = ["w-28", "w-24", "w-20"];
  return (
    <div
      className="space-y-2 px-4 py-3"
      aria-busy="true"
      aria-label="Loading checks"
    >
      {widths.map((w, i) => (
        <div key={i} className="flex h-6 items-center gap-2">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className={`h-3 ${w}`} />
          <Skeleton className="ml-auto h-3 w-10" />
        </div>
      ))}
    </div>
  );
}
