// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// `bun run dev` (scripts/dev.ts) injects these so the UI auto-registers a
// `local-dev` remote-agent workspace on first load. Absent in prod builds.
const devAgentUrl = process.env.VITE_DEV_AGENT_URL ?? "";
const devAgentToken = process.env.VITE_DEV_AGENT_TOKEN ?? "";

export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_DEV_AGENT_URL": JSON.stringify(devAgentUrl),
      "import.meta.env.VITE_DEV_AGENT_TOKEN": JSON.stringify(devAgentToken),
    },
  },
});
