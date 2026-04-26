import type { StorageAdapter } from "./types";
import { ServerStorageAdapter } from "./server-adapter";

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = new ServerStorageAdapter();
  }
  return adapter;
}

export const storage = getStorage();
export type { StorageAdapter, Snapshot } from "./types";
export { StorageNotConnected, attachProvider, resetProviderCache } from "./server-adapter";
export {
  getEndpoint,
  getEndpointSource,
  setEndpoint,
  clearEndpoint,
  type AgentEndpoint,
} from "./endpoint";
