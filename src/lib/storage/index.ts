import type { StorageAdapter } from "./types";
import { LocalStorageAdapter } from "./local-storage-adapter";

let adapter: StorageAdapter | null = null;

function createAdapter(): StorageAdapter {
  if (typeof window !== "undefined" && (window as any).__TAURI__) {
    console.warn(
      "[storage] Tauri detected but TauriSqliteAdapter not implemented (v0.3.0) — falling back to localStorage",
    );
  }
  return new LocalStorageAdapter();
}

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = createAdapter();
  }
  return adapter;
}

export const storage = getStorage();
export type { StorageAdapter, Snapshot } from "./types";
