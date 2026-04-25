import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      ".codex-home/**",
      "e2e/**",
      "dist/**",
      ".multica/**",
      // local-storage-adapter.test.ts uses `bun:test`, not vitest
      "src/lib/storage/local-storage-adapter.test.ts",
    ],
  },
});
