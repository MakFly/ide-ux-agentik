import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FC } from "react";

/**
 * Small SVG ring that visualizes context-window usage.
 *
 * Color thresholds:
 *   - < 70% → muted-foreground
 *   - 70–90% → status-warn (amber)
 *   - ≥ 90% → destructive (red)
 */

const SIZE = 22;
const STROKE = 2.5;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

function formatCompact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  return `${(n / 1_000_000).toFixed(n < 100_000 ? 2 : 1)}M`;
}

function formatPercent(pct: number): string {
  const percent = pct * 100;
  if (percent <= 0) return "0%";
  if (percent < 0.1) return "<0.1%";
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

export const ContextRing: FC<{
  used: number;
  max: number;
  /** Optional breakdown lines shown in the tooltip. */
  breakdown?: Array<{ label: string; value: string }>;
  className?: string;
}> = ({ used, max, breakdown, className }) => {
  const pct = Math.max(0, Math.min(1, max > 0 ? used / max : 0));
  const offset = CIRCUMFERENCE * (1 - pct);

  const tone =
    pct >= 0.9 ? "text-destructive" : pct >= 0.7 ? "text-status-warn" : "text-muted-foreground";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex shrink-0 items-center justify-center", tone, className)}
          aria-label={`Context usage: ${formatCompact(used)} of ${formatCompact(max)} tokens`}
        >
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-muted"
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              className="stroke-current transition-[stroke-dashoffset] duration-300 ease-out"
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-[11px]">
        <div className="font-medium">
          {formatCompact(used)} / {formatCompact(max)} tokens ({formatPercent(pct)})
        </div>
        {breakdown?.length ? (
          <div className="mt-1 space-y-0.5 text-muted-foreground">
            {breakdown.map((b) => (
              <div key={b.label} className="flex justify-between gap-3">
                <span>{b.label}</span>
                <span className="tabular-nums">{b.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
};
