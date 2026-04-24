import { Skeleton } from "@/components/ui/skeleton";

const BRANCH_LABEL_WIDTHS = ["w-32", "w-40", "w-28", "w-36", "w-44", "w-24"];
const BRANCH_DIFF_WIDTHS = ["w-8", "w-10", "w-6", "w-12", "w-9", "w-7"];
const BRANCH_AGE_WIDTHS = ["w-14", "w-16", "w-10", "w-12", "w-20", "w-16"];

export function BranchesSkeleton() {
  return (
    <div className="flex flex-col gap-0.5" aria-busy="true" aria-label="Loading branches">
      {BRANCH_LABEL_WIDTHS.map((labelW, i) => (
        <div
          key={i}
          className="mx-1.5 flex flex-col gap-1 rounded-md px-2 py-1.5"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-2.5 w-2.5 shrink-0 rounded-full" />
            <Skeleton className={`h-3 ${labelW}`} />
            <Skeleton className={`ml-auto h-3 ${BRANCH_DIFF_WIDTHS[i]}`} />
          </div>
          <Skeleton className={`ml-5 h-2 ${BRANCH_AGE_WIDTHS[i]}`} />
        </div>
      ))}
    </div>
  );
}

export function WorktreesSkeleton() {
  const rows = [
    { name: "w-28", path: "w-44", branch: "w-32" },
    { name: "w-36", path: "w-40", branch: "w-28" },
  ];
  return (
    <div
      className="flex flex-col gap-0.5 px-1.5"
      aria-busy="true"
      aria-label="Loading worktrees"
    >
      {rows.map((r, i) => (
        <div key={i} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5">
          <Skeleton className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5">
              <Skeleton className={`h-3 ${r.name}`} />
              <Skeleton className="ml-auto h-4 w-14 rounded" />
            </div>
            <Skeleton className={`h-2.5 ${r.path}`} />
            <Skeleton className={`h-2.5 ${r.branch}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TasksSkeleton() {
  const rows = [
    { title: "w-full", meta: "w-24" },
    { title: "w-4/5", meta: "w-20" },
  ];
  return (
    <div
      className="flex flex-col gap-0.5"
      aria-busy="true"
      aria-label="Loading tasks"
    >
      {rows.map((r, i) => (
        <div key={i} className="mx-1.5 flex items-start gap-2 rounded-md px-2 py-1.5">
          <Skeleton className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className={`h-3 ${r.title}`} />
            <Skeleton className={`h-2.5 ${r.meta}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
