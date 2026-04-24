import { cn } from "@/lib/utils";
import type { FC } from "react";

export const TypingDots: FC<{ className?: string }> = ({ className }) => (
  <span
    aria-label="Streaming…"
    aria-live="off"
    className={cn("ml-1 inline-flex items-center gap-[2px] align-middle", className)}
  >
    {([0, 150, 300] as const).map((delay) => (
      <span
        key={delay}
        className="inline-block size-[5px] rounded-full bg-muted-foreground/60 animate-pulse"
        style={{ animationDelay: `${delay}ms` }}
      />
    ))}
  </span>
);
