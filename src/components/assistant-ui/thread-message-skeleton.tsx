import { Skeleton } from "@/components/ui/skeleton";

export function ThreadMessageSkeleton() {
  return (
    <div
      className="aui-assistant-message-root mx-auto flex w-full max-w-[var(--thread-max-width)] gap-3 px-4 py-3"
      aria-busy="true"
      aria-label="Assistant is thinking"
    >
      <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-2xl bg-muted/30 p-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
