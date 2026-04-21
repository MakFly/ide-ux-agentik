import type React from "react";

/**
 * Brand mark for the app shell. Replace with your own SVG when ready.
 * Generic geometric mark — not affiliated with any third-party brand.
 */
export const LogoIcon = (props: React.ComponentProps<"svg">) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor" />
  </svg>
);

export const Logo = (props: React.ComponentProps<"svg">) => (
  <div className="inline-flex items-center gap-2">
    <LogoIcon className="size-5" />
    <span className="font-semibold tracking-tight" {...(props as React.HTMLAttributes<HTMLSpanElement>)}>
      Acme
    </span>
  </div>
);
