import { FsError, type FsEntry, type FsProvider } from "./types";

/**
 * File System Access API provider. Chromium browsers only (Chrome, Edge, Arc,
 * Brave, Opera). Safari & Firefox fall back by throwing on `pickDirectory`.
 *
 * Handle persistence: opaque `handleId` is stored in IndexedDB under
 * `workspaceHandles` object store. Permission must be re-requested on each
 * new tab session — see `LocalWebProvider.connect()`.
 */

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    queryPermission(desc?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
    requestPermission(desc?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  }
}

const DB_NAME = "ide-ux-agentik";
const STORE = "workspaceHandles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(id: string): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(id: string, value: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pickDirectory(): Promise<{ handleId: string; name: string; handle: FileSystemDirectoryHandle }> {
  if (!window.showDirectoryPicker) {
    throw new FsError(
      "File System Access API not supported in this browser. Use Chrome, Edge, Arc or Brave.",
      "not-supported",
    );
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const handleId = `local:${handle.name}:${Date.now().toString(36)}`;
  await idbPut(handleId, handle);
  return { handleId, name: handle.name, handle };
}

export async function loadHandle(handleId: string): Promise<FileSystemDirectoryHandle | undefined> {
  return idbGet(handleId);
}

export class LocalWebProvider implements FsProvider {
  readonly kind = "local-web" as const;
  private root: FileSystemDirectoryHandle | null = null;

  constructor(
    readonly label: string,
    private readonly handleId: string,
    rootHandle?: FileSystemDirectoryHandle,
  ) {
    if (rootHandle) this.root = rootHandle;
  }

  get rootHandle(): FileSystemDirectoryHandle | null { return this.root; }

  async connect(): Promise<void> {
    if (!this.root) {
      const stored = await loadHandle(this.handleId);
      if (!stored) throw new FsError("Workspace handle missing. Re-pick the folder.", "permission");
      this.root = stored;
    }
    const perm = await this.root.queryPermission({ mode: "readwrite" });
    if (perm === "granted") return;
    const req = await this.root.requestPermission({ mode: "readwrite" });
    if (req !== "granted") throw new FsError("Permission denied to folder.", "permission");
  }

  async disconnect(): Promise<void> {
    /* no-op — handle persists in IDB */
  }

  private async resolveDir(path: string): Promise<FileSystemDirectoryHandle> {
    if (!this.root) throw new FsError("Not connected", "io");
    if (!path || path === "/" || path === ".") return this.root;
    const parts = path.split("/").filter(Boolean);
    let h: FileSystemDirectoryHandle = this.root;
    for (const p of parts) h = await h.getDirectoryHandle(p);
    return h;
  }

  private async resolveFile(path: string): Promise<FileSystemFileHandle> {
    if (!this.root) throw new FsError("Not connected", "io");
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) throw new FsError(`Not a file: ${path}`, "io");
    const fileName = parts[parts.length - 1];
    const dir = await this.resolveDir(parts.slice(0, -1).join("/"));
    return dir.getFileHandle(fileName);
  }

  async list(path: string): Promise<FsEntry[]> {
    const dir = await this.resolveDir(path);
    const entries: FsEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      entries.push({
        name,
        path: path ? `${path}/${name}` : name,
        type: handle.kind === "directory" ? "directory" : "file",
      });
    }
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async stat(path: string): Promise<FsEntry> {
    try {
      const dir = await this.resolveDir(path);
      return { name: dir.name, path, type: "directory" };
    } catch {
      const file = await this.resolveFile(path);
      const blob = await file.getFile();
      return { name: file.name, path, type: "file", size: blob.size, mtime: blob.lastModified };
    }
  }

  async readFile(path: string): Promise<string> {
    const handle = await this.resolveFile(path);
    const file = await handle.getFile();
    return file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.root) throw new FsError("Not connected", "io");
    const parts = path.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const dir = await this.resolveDir(parts.slice(0, -1).join("/"));
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async mkdir(path: string): Promise<void> {
    if (!this.root) throw new FsError("Not connected", "io");
    const parts = path.split("/").filter(Boolean);
    let h: FileSystemDirectoryHandle = this.root;
    for (const p of parts) h = await h.getDirectoryHandle(p, { create: true });
  }

  async remove(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) throw new FsError("Cannot remove root", "io");
    const name = parts[parts.length - 1];
    const parent = await this.resolveDir(parts.slice(0, -1).join("/"));
    await parent.removeEntry(name, { recursive: true });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    // FSA has no native rename — copy + delete.
    const content = await this.readFile(oldPath);
    await this.writeFile(newPath, content);
    await this.remove(oldPath);
  }
}
