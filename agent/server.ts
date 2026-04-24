#!/usr/bin/env bun
/**
 * ide-ux-agentik — remote filesystem agent
 *
 * JSON-RPC 2.0 over WebSocket. First call must be `auth(token)`. Afterwards
 * all filesystem calls are rooted at the configured `--root`.
 *
 * Usage:
 *   bun run agent/server.ts --root /path/to/project --port 7421 --token XYZ
 *
 * Or via env:
 *   AGENT_ROOT=/path AGENT_PORT=7421 AGENT_TOKEN=XYZ bun agent/server.ts
 *
 * Security:
 *   - token is required on every new socket; missing/wrong → close(4401)
 *   - all paths resolved + asserted to stay under AGENT_ROOT
 *   - agent binds to 0.0.0.0 by default; put it behind nginx/caddy with TLS
 *     for real-world use (wss://) or bind to 127.0.0.1 + SSH port-forward
 */

import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

type ServerOpts = { root: string; port: number; token: string; host: string };

function parseArgs(): ServerOpts {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) args.set(a.slice(2), process.argv[++i] ?? "");
  }
  const root = path.resolve(args.get("root") ?? process.env.AGENT_ROOT ?? process.cwd());
  const port = Number(args.get("port") ?? process.env.AGENT_PORT ?? 7421);
  const token = args.get("token") ?? process.env.AGENT_TOKEN ?? "";
  const host = args.get("host") ?? process.env.AGENT_HOST ?? "0.0.0.0";
  if (!token) {
    console.error("[agent] AGENT_TOKEN required (pass --token XYZ or env AGENT_TOKEN=XYZ)");
    process.exit(1);
  }
  return { root, port, token, host };
}

const { root, port, token, host } = parseArgs();

function safeResolve(p: string): string {
  const clean = p.replace(/^\/+/, "").replace(/\.\./g, "");
  const abs = path.resolve(root, clean);
  if (!abs.startsWith(root)) throw new Error(`path escapes root: ${p}`);
  return abs;
}

type Ctx = {
  authed: boolean;
  watchers: Map<string, FSWatcher>;
  ws: { send: (d: string) => void };
};

type Handler = (params: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

const methods: Record<string, Handler> = {
  async auth({ token: t }, ctx) {
    if (t !== token) throw new Error("auth failed");
    ctx.authed = true;
    return { ok: true, root };
  },
  async ls({ path: p }) {
    const abs = safeResolve(String(p ?? ""));
    const items = await fs.readdir(abs, { withFileTypes: true });
    return items
      .map((d) => ({
        name: d.name,
        path: path.posix.join(String(p ?? "").replace(/^\/+/, ""), d.name),
        type: d.isDirectory() ? ("directory" as const) : ("file" as const),
      }))
      .sort((a, b) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));
  },
  async stat({ path: p }) {
    const abs = safeResolve(String(p ?? ""));
    const s = await fs.stat(abs);
    return {
      name: path.basename(abs),
      path: String(p ?? ""),
      type: s.isDirectory() ? ("directory" as const) : ("file" as const),
      size: s.size,
      mtime: s.mtimeMs,
    };
  },
  async readFile({ path: p }) {
    const abs = safeResolve(String(p));
    return fs.readFile(abs, "utf8");
  },
  async writeFile({ path: p, content }) {
    const abs = safeResolve(String(p));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(content ?? ""), "utf8");
    return { ok: true };
  },
  async mkdir({ path: p }) {
    const abs = safeResolve(String(p));
    await fs.mkdir(abs, { recursive: true });
    return { ok: true };
  },
  async remove({ path: p }) {
    const abs = safeResolve(String(p));
    await fs.rm(abs, { recursive: true, force: true });
    return { ok: true };
  },
  async rename({ oldPath, newPath }) {
    const a = safeResolve(String(oldPath));
    const b = safeResolve(String(newPath));
    await fs.mkdir(path.dirname(b), { recursive: true });
    await fs.rename(a, b);
    return { ok: true };
  },
  async watch({ path: p, subId }, ctx) {
    const abs = safeResolve(String(p ?? ""));
    const id = String(subId);
    const w = watch(abs, { recursive: true }, (type, file) => {
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "watch",
          params: {
            subId: id,
            event: { kind: type === "rename" ? "renamed" : "modified", path: file ?? "" },
          },
        }),
      );
    });
    ctx.watchers.set(id, w);
    return { ok: true };
  },
  async unwatch({ subId }, ctx) {
    const id = String(subId);
    ctx.watchers.get(id)?.close();
    ctx.watchers.delete(id);
    return { ok: true };
  },
};

Bun.serve({
  hostname: host,
  port,
  fetch(req, srv) {
    const upgraded = srv.upgrade(req, {
      data: { authed: false, watchers: new Map<string, FSWatcher>(), ws: null },
    });
    if (upgraded) return;
    return new Response(
      JSON.stringify({ service: "ide-ux-agentik-agent", root, ready: true }),
      { headers: { "content-type": "application/json" } },
    );
  },
  websocket: {
    open(ws) {
      (ws.data as Ctx).ws = { send: (d: string) => ws.send(d) };
      const authTimeout = setTimeout(() => {
        if (!(ws.data as Ctx).authed) {
          ws.close(4401, "auth timeout");
        }
      }, 5000);
      (ws.data as unknown as { authTimeout: NodeJS.Timeout }).authTimeout = authTimeout;
    },
    async message(ws, raw) {
      const ctx = ws.data as Ctx;
      let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg.method || typeof msg.id !== "number" && typeof msg.id !== "string") return;

      const handler = methods[msg.method];
      if (!handler) {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } }));
        return;
      }
      if (!ctx.authed && msg.method !== "auth") {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32001, message: "unauthenticated" } }));
        return;
      }
      try {
        const result = await handler(msg.params ?? {}, ctx);
        if (msg.method === "auth") {
          clearTimeout((ws.data as unknown as { authTimeout: NodeJS.Timeout }).authTimeout);
        }
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      } catch (e) {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32000, message: e instanceof Error ? e.message : String(e) },
          }),
        );
      }
    },
    close(ws) {
      const ctx = ws.data as Ctx;
      for (const w of ctx.watchers.values()) w.close();
      ctx.watchers.clear();
    },
  },
});

console.log(`[agent] listening on ws://${host}:${port}  root=${root}  token=${token.slice(0, 6)}…`);
console.log(`[agent] connect from the webapp: wss://<public-host>:${port}  + token`);

// Generate a token if you need one:
if (process.env.AGENT_GENERATE_TOKEN) {
  console.log(`suggested token: ${randomUUID()}`);
}
