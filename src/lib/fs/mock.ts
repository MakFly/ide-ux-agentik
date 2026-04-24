import { FsError, type FsEntry, type FsProvider } from "./types";

/**
 * Mock provider — backed by an in-memory tree. Used for the seeded demo
 * workspaces (`ws-sc`, `ws-landing`) that ship with the app.
 *
 * Not wired to the Zustand store directly; callers provide the tree.
 */
export class MockProvider implements FsProvider {
  readonly kind = "mock" as const;

  constructor(
    readonly label: string,
    private tree: Record<string, string | Record<string, unknown>> = {},
  ) {}

  async connect() {}
  async disconnect() {}

  private resolve(path: string): { parent: Record<string, unknown>; key: string } | null {
    if (path === "" || path === "/" || path === ".") {
      return { parent: this.tree as Record<string, unknown>, key: "" };
    }
    const parts = path.split("/").filter(Boolean);
    let node: Record<string, unknown> = this.tree as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (!next || typeof next === "string") return null;
      node = next as Record<string, unknown>;
    }
    return { parent: node, key: parts[parts.length - 1] };
  }

  async list(path: string): Promise<FsEntry[]> {
    const r = this.resolve(path);
    if (!r) throw new FsError(`Not found: ${path}`, "not-found");
    const target = r.key === "" ? r.parent : (r.parent[r.key] as Record<string, unknown>);
    if (!target || typeof target === "string") throw new FsError(`Not a directory: ${path}`, "io");
    const entries: FsEntry[] = Object.entries(target).map(([name, v]) => ({
      name,
      path: path ? `${path}/${name}` : name,
      type: typeof v === "string" ? "file" : "directory",
    }));
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async stat(path: string): Promise<FsEntry> {
    const r = this.resolve(path);
    if (!r) throw new FsError(`Not found: ${path}`, "not-found");
    const v = r.key === "" ? r.parent : r.parent[r.key];
    if (v === undefined) throw new FsError(`Not found: ${path}`, "not-found");
    return {
      name: r.key || "/",
      path,
      type: typeof v === "string" ? "file" : "directory",
    };
  }

  async readFile(path: string): Promise<string> {
    const r = this.resolve(path);
    if (!r || typeof r.parent[r.key] !== "string") {
      throw new FsError(`Not a file: ${path}`, "not-found");
    }
    return r.parent[r.key] as string;
  }

  async writeFile(path: string, content: string) {
    const r = this.resolve(path);
    if (!r) throw new FsError(`Bad path: ${path}`, "io");
    r.parent[r.key] = content;
  }

  async mkdir(path: string) {
    const r = this.resolve(path);
    if (!r) throw new FsError(`Bad path: ${path}`, "io");
    if (!(r.key in r.parent)) r.parent[r.key] = {};
  }

  async remove(path: string) {
    const r = this.resolve(path);
    if (!r) return;
    delete r.parent[r.key];
  }

  async rename(oldPath: string, newPath: string) {
    const content = await this.readFile(oldPath).catch(() => null);
    if (content !== null) {
      await this.writeFile(newPath, content);
      await this.remove(oldPath);
    }
  }
}
