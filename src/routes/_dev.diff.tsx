// DEV ONLY — visual playground for <DiffView>. Not linked from the main UI.
// Access: http://localhost:8080/_dev/diff (or port 8099 in e2e)
import { createFileRoute } from "@tanstack/react-router";
import { DiffView } from "@/components/ide/diff-view";

const SAMPLE_PATCH = `\
diff --git a/src/lib/utils.ts b/src/lib/utils.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/lib/utils.ts
+++ b/src/lib/utils.ts
@@ -1,7 +1,10 @@
 import { clsx, type ClassValue } from "clsx";
 import { twMerge } from "tailwind-merge";

-export function cn(...inputs: ClassValue[]) {
-  return twMerge(clsx(inputs));
+export function cn(...inputs: ClassValue[]): string {
+  return twMerge(clsx(inputs));
+}
+
+export function noop(..._args: unknown[]): void {
+  // intentional no-op
 }
diff --git a/src/store/ide.ts b/src/store/ide.ts
index aabbcc1..ddeeff2 100644
--- a/src/store/ide.ts
+++ b/src/store/ide.ts
@@ -42,6 +42,8 @@ interface IDEState {
   activeAgent: AgentKind;
   theme: "dark" | "light";
+  showDiff: boolean;
+  diffPatch: string;
 }

@@ -55,7 +57,9 @@ export const useIDE = create<IDEState>()(
     activeAgent: "claude",
     theme: "dark",
+    showDiff: false,
+    diffPatch: "",
   }),
 );
`;

export const Route = createFileRoute("/_dev/diff")({
  component: DevDiffPage,
});

function DevDiffPage() {
  if (!import.meta.env.DEV) return <p className="p-4 text-sm text-muted-foreground">Dev only.</p>;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <h1 className="mb-1 text-base font-semibold">DiffView — dev playground</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        Route: <code>/_dev/diff</code> · dev only
      </p>
      <DiffView patch={SAMPLE_PATCH} className="max-w-3xl" />
    </div>
  );
}
