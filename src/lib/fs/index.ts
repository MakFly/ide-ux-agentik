import type { FsProvider, WorkspaceSource } from "./types";
import { MockProvider } from "./mock";
import { LocalWebProvider, loadHandle } from "./local-web";
import { RemoteAgentProvider } from "./remote-agent";
import { MOCK_ENABLED } from "@/lib/env";

export * from "./types";
export { pickDirectory } from "./local-web";

const cache = new Map<string, FsProvider>();

function keyOf(src: WorkspaceSource): string {
  switch (src.kind) {
    case "mock":
      return `mock:${src.id}`;
    case "local-web":
      return `local:${src.handleId}`;
    case "remote-agent":
      return `remote:${src.url}`;
  }
}

export async function providerFor(
  src: WorkspaceSource,
  label: string,
  mockTree?: Record<string, string | Record<string, unknown>>,
): Promise<FsProvider> {
  const k = keyOf(src);
  const cached = cache.get(k);
  if (cached) return cached;

  let provider: FsProvider;
  switch (src.kind) {
    case "mock":
      if (!MOCK_ENABLED) {
        console.warn(
          `[providerFor] mock workspace "${label}" requested but VITE_ENABLE_MOCK is off`,
        );
      }
      provider = new MockProvider(label, mockTree);
      break;
    case "local-web": {
      const handle = await loadHandle(src.handleId);
      provider = new LocalWebProvider(label, src.handleId, handle);
      break;
    }
    case "remote-agent":
      provider = new RemoteAgentProvider(label, src.url, src.token);
      break;
  }
  await provider.connect();
  cache.set(k, provider);
  return provider;
}

export function dropProvider(src: WorkspaceSource) {
  const k = keyOf(src);
  const p = cache.get(k);
  if (p) {
    p.disconnect().catch(() => {});
    cache.delete(k);
  }
}

export const isLocalWebSupported = () =>
  typeof window !== "undefined" && "showDirectoryPicker" in window;
