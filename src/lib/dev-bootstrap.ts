/**
 * Dev-mode bootstrap: if `scripts/dev.ts` injected VITE_DEV_AGENT_URL/TOKEN,
 * auto-register a `local-dev` remote-agent workspace on first load so Codex
 * & co. spawn with zero configuration.
 *
 * Idempotent: re-runs skip if a workspace with the same URL already exists.
 * No-op in production builds or when a Tauri provider is available.
 */
import { toast } from "sonner";
import { providerFor, type WorkspaceSource } from "@/lib/fs";
import { useIDE } from "@/store/ide";

const LABEL = "local-dev";

/** Module-level lock: prevents StrictMode double-effect from creating a
 *  duplicate workspace. Both invocations await the same in-flight promise. */
let bootstrapInflight: Promise<void> | null = null;

export async function autoRegisterDevAgent(): Promise<void> {
  if (bootstrapInflight) return bootstrapInflight;
  bootstrapInflight = runBootstrap().finally(() => {
    bootstrapInflight = null;
  });
  return bootstrapInflight;
}

async function runBootstrap(): Promise<void> {
  const url = import.meta.env.VITE_DEV_AGENT_URL as string | undefined;
  const token = import.meta.env.VITE_DEV_AGENT_TOKEN as string | undefined;
  if (!url || !token) {
    console.info("[dev-bootstrap] no VITE_DEV_AGENT_* env — skipping auto-register");
    return;
  }
  console.info("[dev-bootstrap] probing", url);

  const state = useIDE.getState();
  const existing = state.workspaces.find(
    (w) => w.source?.kind === "remote-agent" && w.source.label === LABEL,
  );
  if (existing) {
    // scripts/dev.ts regenerates AGENT_TOKEN (and sometimes the port) on each
    // run. The persisted workspace may carry a stale url/token — refresh them
    // from the current env before anyone tries to connect.
    const current = existing.source as Extract<WorkspaceSource, { kind: "remote-agent" }>;
    if (current.url !== url || current.token !== token) {
      useIDE.setState((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === existing.id
            ? { ...w, source: { ...current, url, token } }
            : w,
        ),
      }));
      console.info("[dev-bootstrap] refreshed token/url for", existing.id);
    }
    if (state.activeWorkspaceId !== existing.id) state.setActiveWorkspace(existing.id);
    console.info("[dev-bootstrap] reusing workspace", existing.id);
    return;
  }

  const source: WorkspaceSource = { kind: "remote-agent", url, token, label: LABEL };
  try {
    const provider = await providerFor(source, LABEL);
    await provider.list("");
  } catch (e) {
    console.warn("[dev-bootstrap] local agent unreachable at", url, e);
    toast.error(`Dev agent unreachable at ${url} — check the [agent] logs in your terminal.`);
    return;
  }

  const id = state.addWorkspace(LABEL, source);
  state.setActiveWorkspace(id);
  toast.success(`Connected to ${LABEL} (${url})`);
  console.info("[dev-bootstrap] workspace registered + activated", id);
}
