import type { FsProvider } from "@/lib/fs";
import { LocalWebProvider } from "@/lib/fs/local-web";

export type GitFileStatus = "clean" | "modified" | "added" | "deleted" | "untracked";
export type GitStatusMap = Map<string, GitFileStatus>;

type FsAdapter = {
  promises: {
    readFile(path: string, opts?: { encoding?: string }): Promise<Uint8Array | string>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    unlink(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
    rmdir(path: string): Promise<void>;
    stat(path: string): Promise<{ type: string; size: number; ctimeSeconds: number; mtimeSeconds: number; mode: number; ino: number; uid: number; gid: number }>;
    lstat(path: string): Promise<{ type: string; size: number; ctimeSeconds: number; mtimeSeconds: number; mode: number; ino: number; uid: number; gid: number }>;
  };
};

function buildFsAdapter(root: FileSystemDirectoryHandle): FsAdapter {
  async function resolveDir(path: string): Promise<FileSystemDirectoryHandle> {
    const parts = path.split("/").filter(Boolean);
    let h: FileSystemDirectoryHandle = root;
    for (const p of parts) h = await h.getDirectoryHandle(p);
    return h;
  }

  async function resolveFile(path: string): Promise<FileSystemFileHandle> {
    const parts = path.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const dir = await resolveDir(parts.slice(0, -1).join("/"));
    return dir.getFileHandle(fileName);
  }

  const statResult = (name: string, size: number, mtime: number, isDir: boolean) => ({
    type: isDir ? "dir" : "file",
    size,
    ctimeSeconds: Math.floor(mtime / 1000),
    mtimeSeconds: Math.floor(mtime / 1000),
    mode: isDir ? 0o40755 : 0o100644,
    ino: 0,
    uid: 0,
    gid: 0,
  });

  return {
    promises: {
      async readFile(path, opts) {
        const handle = await resolveFile(path);
        const file = await handle.getFile();
        if (opts?.encoding === "utf8" || opts?.encoding === "utf-8") {
          return file.text();
        }
        const ab = await file.arrayBuffer();
        return new Uint8Array(ab);
      },
      async writeFile(path, data) {
        const parts = path.split("/").filter(Boolean);
        const fileName = parts[parts.length - 1];
        const dir = await resolveDir(parts.slice(0, -1).join("/"));
        const handle = await dir.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(data instanceof Uint8Array ? data.buffer as ArrayBuffer : data);
        await writable.close();
      },
      async unlink(path) {
        const parts = path.split("/").filter(Boolean);
        const name = parts[parts.length - 1];
        const parent = await resolveDir(parts.slice(0, -1).join("/"));
        await parent.removeEntry(name);
      },
      async readdir(path) {
        const dir = await resolveDir(path);
        const names: string[] = [];
        for await (const [name] of dir.entries()) names.push(name);
        return names;
      },
      async mkdir(path) {
        const parts = path.split("/").filter(Boolean);
        let h: FileSystemDirectoryHandle = root;
        for (const p of parts) h = await h.getDirectoryHandle(p, { create: true });
      },
      async rmdir(path) {
        const parts = path.split("/").filter(Boolean);
        const name = parts[parts.length - 1];
        const parent = await resolveDir(parts.slice(0, -1).join("/"));
        await parent.removeEntry(name, { recursive: true });
      },
      async stat(path) {
        if (!path || path === "/" || path === ".") {
          return statResult(root.name, 0, Date.now(), true);
        }
        try {
          await resolveDir(path);
          return statResult(path.split("/").pop()!, 0, Date.now(), true);
        } catch {
          const handle = await resolveFile(path);
          const file = await handle.getFile();
          return statResult(handle.name, file.size, file.lastModified, false);
        }
      },
      async lstat(path) {
        if (!path || path === "/" || path === ".") {
          return statResult(root.name, 0, Date.now(), true);
        }
        try {
          await resolveDir(path);
          return statResult(path.split("/").pop()!, 0, Date.now(), true);
        } catch {
          const handle = await resolveFile(path);
          const file = await handle.getFile();
          return statResult(handle.name, file.size, file.lastModified, false);
        }
      },
    },
  };
}

export async function computeStatus(provider: FsProvider): Promise<GitStatusMap> {
  const map: GitStatusMap = new Map();

  if (!(provider instanceof LocalWebProvider)) {
    return map;
  }

  const rootHandle = provider.rootHandle;
  if (!rootHandle) return map;

  try {
    const git = await import("isomorphic-git");
    const fs = buildFsAdapter(rootHandle);

    // Vérifie que .git/ existe (sinon ce n'est pas un repo)
    try {
      await rootHandle.getDirectoryHandle(".git");
    } catch {
      return map;
    }

    const matrix = await git.statusMatrix({ fs, dir: "/" });

    for (const [filepath, head, workdir, stage] of matrix) {
      let status: GitFileStatus;

      if (head === 0 && workdir === 2 && stage === 0) {
        status = "untracked";
      } else if (head === 1 && workdir === 2 && stage === 1) {
        status = "modified";
      } else if (head === 0 && workdir === 2 && stage === 2) {
        status = "added";
      } else if (head === 1 && workdir === 0 && stage === 1) {
        status = "deleted";
      } else if (head === workdir && workdir === stage) {
        continue;
      } else {
        status = "modified";
      }

      map.set(filepath as string, status);
    }
  } catch {
    // Retourne Map vide silencieusement si pas de repo git ou erreur
  }

  return map;
}
