import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, Loader2, XCircle } from "lucide-react";

import type { CheckStatus } from "@/lib/providers-check";

export function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-[13.5px] text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div>}
      </div>
      {control}
    </div>
  );
}

export function Card({
  title,
  description,
  children,
  id,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      {(title || description) && (
        <header className="mb-3">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </h2>
          )}
          {description && <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>}
        </header>
      )}
      <div className="rounded-xl border border-border/80 bg-card px-5 py-1">{children}</div>
    </section>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
      {description && <p className="mt-1.5 text-[13px] text-muted-foreground">{description}</p>}
    </header>
  );
}

export function statusIcon(s: CheckStatus) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (s) {
    case "ok":
      return <CheckCircle2 className={`${cls} text-status-add`} />;
    case "warn":
      return <CircleAlert className={`${cls} text-status-warn`} />;
    case "fail":
      return <XCircle className={`${cls} text-status-del`} />;
    case "running":
      return <Loader2 className={`${cls} animate-spin text-muted-foreground`} />;
    default:
      return <CircleDashed className={`${cls} text-muted-foreground`} />;
  }
}
