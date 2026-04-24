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

import { spawn as cpSpawn, execFile as cpExecFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  openDb,
  closeDb,
  sessionsRepo,
  messagesRepo,
  snapshotsRepo,
  summariesRepo,
  blobsRepo,
} from "./persistence/db.ts";
import { importCodexRollouts } from "./persistence/import-codex.ts";

// node-pty provides a real PTY. Required for interactive CLIs (codex, claude, vim).
// The agent runs under Node because Bun's spawn path breaks PTY IO for some CLIs.
import type { IPty } from "node-pty";
let nodePty: typeof import("node-pty") | null = null;
try {
  nodePty = await import("node-pty");
} catch {
  console.warn("[agent] node-pty unavailable — interactive CLIs will not work");
}

/** Host env vars safe to inherit in child processes. Secrets (AWS_*, GITHUB_TOKEN,
 * OPENAI_API_KEY, etc.) are intentionally NOT in this list — clients must pass
 * them explicitly via the `env` param. */
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "SHELL",
  "TMPDIR",
  "LOGNAME",
  "PWD",
  "HOSTNAME",
] as const;

function safeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (typeof v === "string") base[k] = v;
  }
  return { ...base, ...extra };
}

const ALLOWED_CHAT_FLAGS: Record<string, ReadonlySet<string>> = {
  codex: new Set(["--model", "-m", "--effort", "--profile", "-c"]),
  claude: new Set(["--model", "--effort", "-p", "--output-format", "--verbose"]),
};

function validateExtraArgs(cli: string, args: string[]): string[] {
  const allow = ALLOWED_CHAT_FLAGS[cli];
  if (!allow) return [];
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] ?? "");
    // A flag token starts with `-`. Value tokens that follow are passed through as-is.
    if (a.startsWith("-")) {
      if (!allow.has(a)) {
        throw new Error(`chat.spawn: forbidden flag "${a}" for cli "${cli}"`);
      }
      out.push(a);
      // If the next token does not start with `-`, treat as value.
      if (i + 1 < args.length && !String(args[i + 1] ?? "").startsWith("-")) {
        out.push(String(args[++i]));
      }
    } else {
      // Bare value without preceding flag — reject.
      throw new Error(`chat.spawn: unexpected positional arg "${a}"`);
    }
  }
  return out;
}

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

// Init SQLite persistence layer eagerly so DDL runs before first connection.
openDb();
importCodexRollouts().catch((e) => console.warn("[persistence] importCodexRollouts error:", e));

function safeResolve(p: string): string {
  const clean = p.replace(/^\/+/, "").replace(/\.\./g, "");
  const abs = path.resolve(root, clean);
  if (!abs.startsWith(root)) throw new Error(`path escapes root: ${p}`);
  return abs;
}

type PtySession = {
  id: string;
  cmd: string;
  cwd: string;
  alive: boolean;
  pty?: IPty;
};

type ChatSession = {
  id: string;
  proc: ChildProcess;
  alive: boolean;
};

type Ctx = {
  authed: boolean;
  watchers: Map<string, FSWatcher>;
  ptySessions: Map<string, PtySession>;
  chatSessions: Map<string, ChatSession>;
  ws: { send: (d: string) => void };
};

type Handler = (params: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

async function validateGitRepo(workspacePath: unknown): Promise<string> {
  const wp = String(workspacePath ?? "").trim();
  if (!wp) throw new Error("workspacePath is required");
  try {
    const stat = await fs.stat(wp);
    if (!stat.isDirectory()) throw new Error(`not a directory: ${wp}`);
  } catch (e) {
    throw new Error(`workspacePath does not exist or is not accessible: ${wp}`);
  }
  try {
    const gitStat = await fs.stat(path.join(wp, ".git"));
    if (!gitStat.isDirectory() && !gitStat.isFile()) throw new Error();
  } catch {
    throw new Error(`not a git repository (no .git found): ${wp}`);
  }
  return wp;
}

function gitExec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    cpExecFile("git", args, { cwd, encoding: "utf8", env: safeEnv() }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args[0]} failed: ${stderr || err.message}`));
        return;
      }
      resolve({ stdout: stdout as string, stderr: stderr as string });
    });
  });
}

type GitEntry = { path: string; staged: boolean; unstaged: boolean; kind: string };

function parseGitStatus(output: string): { branch: string; files: GitEntry[] } {
  const lines = output.split("\n");
  let branch = "HEAD";
  const files: GitEntry[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const branchPart = line.slice(3).split("...")[0];
      branch = branchPart || "HEAD";
      continue;
    }
    if (line.length < 2) continue;
    const x = line[0]; // index (staged)
    const y = line[1]; // worktree (unstaged)
    const filePath = line.slice(3);
    if (!filePath) continue;
    let kind = "modified";
    if (x === "?" && y === "?") kind = "untracked";
    else if (x === "A" || y === "A") kind = "added";
    else if (x === "D" || y === "D") kind = "deleted";
    else if (x === "R" || y === "R") kind = "renamed";
    files.push({
      path: filePath,
      staged: x !== " " && x !== "?" && x !== "!",
      unstaged: y !== " " && y !== "?" && y !== "!",
      kind,
    });
  }
  return { branch, files };
}

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
      .sort((a, b) =>
        a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name),
      );
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

  async "pty.spawn"({ cmd, args, cwd, env, cols, rows }, ctx) {
    const shell = process.env.SHELL ?? "/bin/bash";
    const spawnCmd = cmd ? String(cmd) : shell;
    const spawnArgs: string[] = Array.isArray(args) ? (args as string[]) : cmd ? [] : ["-il"];
    const termCols = typeof cols === "number" ? cols : 80;
    const termRows = typeof rows === "number" ? rows : 24;

    let resolvedCwd: string;
    try {
      resolvedCwd = cwd ? safeResolve(String(cwd)) : root;
    } catch {
      resolvedCwd = root;
    }

    const id = randomUUID();
    const mergedEnv = safeEnv({
      TERM: "xterm-256color",
      ...((env as Record<string, string> | undefined) ?? {}),
    });

    if (nodePty) {
      const ptyProc = nodePty.spawn(spawnCmd, spawnArgs, {
        name: "xterm-256color",
        cols: termCols,
        rows: termRows,
        cwd: resolvedCwd,
        env: mergedEnv,
      });

      const session: PtySession = {
        id,
        cmd: spawnCmd,
        cwd: resolvedCwd,
        alive: true,
        pty: ptyProc,
      };
      ctx.ptySessions.set(id, session);

      ptyProc.onData((data) => {
        ctx.ws.send(JSON.stringify({ jsonrpc: "2.0", method: "pty.data", params: { id, data } }));
      });
      ptyProc.onExit(({ exitCode, signal }) => {
        session.alive = false;
        ctx.ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "pty.exit",
            params: { id, code: exitCode, signal: signal ?? null },
          }),
        );
        ctx.ptySessions.delete(id);
      });
    } else {
      throw new Error("node-pty unavailable: cannot spawn PTY sessions");
    }

    return { id };
  },

  async "pty.write"({ id, data }, ctx) {
    const session = ctx.ptySessions.get(String(id));
    if (!session || !session.alive) throw new Error(`PTY session not found: ${id}`);
    if (session.pty) {
      session.pty.write(String(data));
    }
    return { ok: true };
  },

  async "pty.resize"({ id, cols, rows }, ctx) {
    const session = ctx.ptySessions.get(String(id));
    if (!session || !session.alive) throw new Error(`PTY session not found: ${id}`);
    if (session.pty) {
      session.pty.resize(Number(cols), Number(rows));
    }
    return { ok: true };
  },

  async "pty.kill"({ id, signal }, ctx) {
    const session = ctx.ptySessions.get(String(id));
    if (!session) throw new Error(`PTY session not found: ${id}`);
    if (session.pty) {
      session.pty.kill(signal ? String(signal) : "SIGTERM");
    }
    session.alive = false;
    ctx.ptySessions.delete(String(id));
    return { ok: true };
  },

  async "pty.list"(_params, ctx) {
    const sessions = Array.from(ctx.ptySessions.values()).map(({ id, cmd, cwd, alive }) => ({
      id,
      cmd,
      cwd,
      alive,
    }));
    return { sessions };
  },

  /**
   * Spawn a non-interactive chat-CLI subprocess (no PTY). Meant for
   * `codex exec --json` / `claude -p --output-format stream-json`: the child
   * prints newline-delimited JSON events to stdout; each line is forwarded to
   * the client as a `chat.event` notification. On process exit, `chat.end` is
   * sent once with `{ id, code, signal }`.
   *
   * Params: { cli: "codex" | "claude", prompt: string, cwd?: string,
   *          env?: Record<string,string>, extraArgs?: string[] }
   */
  async "chat.spawn"({ cli, prompt, cwd, env, extraArgs }, ctx) {
    const cliKind = String(cli ?? "codex");
    const text = String(prompt ?? "");
    if (!text.trim()) throw new Error("chat.spawn: prompt is required");

    let resolvedCwd: string;
    try {
      resolvedCwd = cwd ? safeResolve(String(cwd)) : root;
    } catch {
      resolvedCwd = root;
    }

    const safeExtra = Array.isArray(extraArgs)
      ? validateExtraArgs(cliKind, extraArgs as string[])
      : [];

    let execCmd: string;
    let execArgs: string[];
    if (cliKind === "codex") {
      execCmd = "codex";
      execArgs = ["exec", "--json", ...safeExtra, text];
    } else if (cliKind === "claude") {
      execCmd = "claude";
      execArgs = ["-p", text, "--output-format", "stream-json", "--verbose", ...safeExtra];
    } else {
      throw new Error(`chat.spawn: unsupported cli "${cliKind}"`);
    }

    const mergedEnv = safeEnv((env as Record<string, string> | undefined) ?? {});

    const id = randomUUID();
    const proc = cpSpawn(execCmd, execArgs, {
      cwd: resolvedCwd,
      env: mergedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const session: ChatSession = { id, proc, alive: true };
    ctx.chatSessions.set(id, session);

    // Buffer stdout, split on newlines, parse each as JSON, forward as event.
    let buf = "";
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt: unknown;
        try {
          evt = JSON.parse(line);
        } catch {
          evt = { type: "raw", text: line };
        }
        ctx.ws.send(
          JSON.stringify({ jsonrpc: "2.0", method: "chat.event", params: { id, event: evt } }),
        );
      }
    });

    // stderr is forwarded as a synthetic stderr event so the UI can surface it.
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "chat.event",
          params: { id, event: { type: "stderr", text: chunk } },
        }),
      );
    });

    proc.on("exit", (code, signal) => {
      if (!session.alive) return; // error handler already ended this session
      session.alive = false;
      // Flush any trailing line that did not end with \n.
      if (buf.trim()) {
        try {
          const evt = JSON.parse(buf.trim());
          ctx.ws.send(
            JSON.stringify({ jsonrpc: "2.0", method: "chat.event", params: { id, event: evt } }),
          );
        } catch {
          /* ignore malformed trailing line */
        }
        buf = "";
      }
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "chat.end",
          params: { id, code, signal: signal ?? null },
        }),
      );
      ctx.chatSessions.delete(id);
    });

    proc.on("error", (err) => {
      if (!session.alive) return; // already ended
      session.alive = false;
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "chat.event",
          params: { id, event: { type: "error", message: err.message } },
        }),
      );
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "chat.end",
          params: { id, code: null, signal: "error" },
        }),
      );
      ctx.chatSessions.delete(id);
    });

    return { id };
  },

  async "chat.kill"({ id, signal }, ctx) {
    const session = ctx.chatSessions.get(String(id));
    if (!session) throw new Error(`chat session not found: ${id}`);
    try {
      session.proc.kill((signal ? String(signal) : "SIGTERM") as NodeJS.Signals);
    } catch {
      /* ignore */
    }
    session.alive = false;
    return { ok: true };
  },

  /**
   * Git helpers. Each RPC validates that `workspacePath` exists and contains
   * a `.git/` directory. All git invocations use `execFile` — no shell, no
   * string interpolation.
   */
  async "git.status"({ workspacePath }) {
    const cwd = await validateGitRepo(workspacePath);
    const { stdout } = await gitExec(["status", "--porcelain=v1", "-b"], cwd);
    return parseGitStatus(stdout);
  },

  async "git.stage"({ workspacePath, paths }) {
    const cwd = await validateGitRepo(workspacePath);
    if (!Array.isArray(paths) || paths.length === 0)
      throw new Error("git.stage: paths must be a non-empty array");
    const safePaths = (paths as unknown[]).map((p) => String(p));
    await gitExec(["add", "--", ...safePaths], cwd);
    return { ok: true };
  },

  async "git.commit"({ workspacePath, message }) {
    const cwd = await validateGitRepo(workspacePath);
    const msg = String(message ?? "").trim();
    if (!msg) throw new Error("git.commit: message must not be empty");
    const { stdout } = await gitExec(["commit", "-m", msg], cwd);
    // Parse the sha from the first line: [branch abc1234] message
    const match = stdout.match(/\[[\w/\-.]+ ([a-f0-9]+)\]/);
    return { sha: match?.[1] ?? null, message: msg };
  },

  async "git.diff"({ workspacePath, staged }) {
    const cwd = await validateGitRepo(workspacePath);
    const args = staged ? ["diff", "--cached"] : ["diff"];
    const { stdout } = await gitExec(args, cwd);
    return { patch: stdout };
  },

  // ─── Persistence RPC ──────────────────────────────────────────────────────

  async "sessions.list"({ workspaceId }) {
    const id = String(workspaceId ?? "").trim();
    if (!id) throw new Error("sessions.list: workspaceId is required");
    return sessionsRepo.list(id);
  },

  async "sessions.create"({ id, workspaceId, cli, title, model, approvalMode }) {
    const wid = String(workspaceId ?? "").trim();
    const c = String(cli ?? "").trim();
    if (!wid) throw new Error("sessions.create: workspaceId is required");
    if (!c) throw new Error("sessions.create: cli is required");
    return sessionsRepo.create({
      id: id !== undefined ? String(id).trim() || undefined : undefined,
      workspaceId: wid,
      cli: c,
      title: title !== undefined ? String(title) : undefined,
      model: model !== undefined ? String(model) : undefined,
      approvalMode: approvalMode !== undefined ? String(approvalMode) : undefined,
    });
  },

  async "sessions.update"({ id, patch }) {
    const sid = String(id ?? "").trim();
    if (!sid) throw new Error("sessions.update: id is required");
    if (!patch || typeof patch !== "object") throw new Error("sessions.update: patch is required");
    const p = patch as Record<string, unknown>;
    const result = sessionsRepo.update(sid, {
      title: p.title !== undefined ? String(p.title) : undefined,
      model: p.model !== undefined ? String(p.model) : undefined,
      approval_mode: p.approval_mode !== undefined ? String(p.approval_mode) : undefined,
      status: p.status !== undefined ? String(p.status) : undefined,
    });
    if (!result) throw new Error(`sessions.update: session not found: ${sid}`);
    return result;
  },

  async "sessions.delete"({ id }) {
    const sid = String(id ?? "").trim();
    if (!sid) throw new Error("sessions.delete: id is required");
    sessionsRepo.delete(sid);
    return { ok: true };
  },

  async "messages.list"({ sessionId, limit, beforeTs }) {
    const sid = String(sessionId ?? "").trim();
    if (!sid) throw new Error("messages.list: sessionId is required");
    return messagesRepo.list({
      sessionId: sid,
      limit: limit !== undefined ? Number(limit) : undefined,
      beforeTs: beforeTs !== undefined ? Number(beforeTs) : undefined,
    });
  },

  async "messages.append"({
    sessionId,
    role,
    parts,
    parentId,
    logicalParentId,
    isSidechain,
    cwd,
    gitBranch,
    slug,
    version,
  }) {
    const sid = String(sessionId ?? "").trim();
    const r = String(role ?? "").trim();
    if (!sid) throw new Error("messages.append: sessionId is required");
    if (!r) throw new Error("messages.append: role is required");
    if (!Array.isArray(parts)) throw new Error("messages.append: parts must be an array");
    return messagesRepo.appendSync({
      sessionId: sid,
      role: r,
      parts: parts as unknown[],
      parentId: parentId !== undefined ? String(parentId) : undefined,
      logicalParentId: logicalParentId !== undefined ? String(logicalParentId) : undefined,
      isSidechain: Boolean(isSidechain),
      cwd: cwd !== undefined ? String(cwd) : undefined,
      gitBranch: gitBranch !== undefined ? String(gitBranch) : undefined,
      slug: slug !== undefined ? String(slug) : undefined,
      version: version !== undefined ? String(version) : undefined,
    });
  },

  async "snapshots.add"({ sessionId, messageId, path: snapshotPath, contentBefore, contentAfter }) {
    const sid = String(sessionId ?? "").trim();
    const p = String(snapshotPath ?? "").trim();
    if (!sid) throw new Error("snapshots.add: sessionId is required");
    if (!p) throw new Error("snapshots.add: path is required");
    return snapshotsRepo.add({
      sessionId: sid,
      messageId: messageId !== undefined ? String(messageId) : undefined,
      path: p,
      contentBefore: contentBefore !== undefined ? String(contentBefore) : undefined,
      contentAfter: contentAfter !== undefined ? String(contentAfter) : undefined,
    });
  },

  async "snapshots.readBlob"({ hash }) {
    const h = String(hash ?? "").trim();
    if (!h) throw new Error("snapshots.readBlob: hash is required");
    const buf = blobsRepo.read(h);
    if (!buf) throw new Error(`snapshots.readBlob: blob not found: ${h}`);
    return { hash: h, size: buf.byteLength, content: buf.toString("utf8") };
  },

  async "summaries.add"({ sessionId, leafUuid, text }) {
    const sid = String(sessionId ?? "").trim();
    const leaf = String(leafUuid ?? "").trim();
    const t = String(text ?? "").trim();
    if (!sid) throw new Error("summaries.add: sessionId is required");
    if (!leaf) throw new Error("summaries.add: leafUuid is required");
    if (!t) throw new Error("summaries.add: text is required");
    return summariesRepo.add({ sessionId: sid, leafUuid: leaf, text: t });
  },

  async "summaries.list"({ sessionId }) {
    const sid = String(sessionId ?? "").trim();
    if (!sid) throw new Error("summaries.list: sessionId is required");
    return summariesRepo.listBySession(sid);
  },

  async "skills.list"() {
    const codexHome = path.join(root, ".codex-home");

    async function parseSkillMd(
      mdPath: string,
      dirName: string,
    ): Promise<{ name: string; description?: string }> {
      let raw: string;
      try {
        raw = await fs.readFile(mdPath, "utf8");
      } catch {
        return { name: dirName };
      }
      if (raw.startsWith("---")) {
        const end = raw.indexOf("\n---", 3);
        if (end !== -1) {
          const fm = raw.slice(3, end);
          const nameMatch = fm.match(/^name:\s*["']?(.+?)["']?\s*$/m);
          const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
          return {
            name: nameMatch?.[1]?.trim() ?? dirName,
            description: descMatch?.[1]?.trim(),
          };
        }
      }
      const firstLine = raw.split("\n").find((l) => l.trim());
      const title = firstLine?.replace(/^#+\s*/, "").trim();
      return { name: title ?? dirName };
    }

    async function resolveIconUrl(skillDir: string, name: string): Promise<string | undefined> {
      const assetsDir = path.join(skillDir, "assets");
      for (const candidate of [`${name}-small.svg`, `${name}.png`]) {
        try {
          await fs.stat(path.join(assetsDir, candidate));
          return path.relative(root, path.join(assetsDir, candidate));
        } catch {
          /* not found */
        }
      }
    }

    type SkillEntry = {
      id: string;
      name: string;
      description?: string;
      kind: "system" | "personal";
      iconUrl?: string;
      source: "codex" | "plugin";
    };
    const skills: SkillEntry[] = [];

    // System skills: .codex-home/skills/.system/*/SKILL.md
    const systemBase = path.join(codexHome, "skills", ".system");
    try {
      const dirs = await fs.readdir(systemBase, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dirPath = path.join(systemBase, d.name);
        const { name, description } = await parseSkillMd(path.join(dirPath, "SKILL.md"), d.name);
        const iconUrl = await resolveIconUrl(dirPath, d.name);
        skills.push({
          id: `system:${d.name}`,
          name,
          description,
          kind: "system",
          source: "codex",
          iconUrl,
        });
      }
    } catch {
      /* no system skills dir */
    }

    // Plugin skills: .codex-home/plugins/cache/*/*/*/skills/**/SKILL.md
    const pluginCache = path.join(codexHome, "plugins", "cache");
    async function scanPluginDir(dir: string): Promise<void> {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          await scanPluginDir(path.join(dir, e.name));
        } else if (e.name === "SKILL.md") {
          const dirPath = path.dirname(path.join(dir, e.name));
          const dirName = path.basename(dirPath);
          const { name, description } = await parseSkillMd(path.join(dir, e.name), dirName);
          const iconUrl = await resolveIconUrl(dirPath, dirName);
          const id = `plugin:${path.relative(pluginCache, path.join(dir, e.name)).replace(/\\/g, "/")}`;
          skills.push({ id, name, description, kind: "personal", source: "plugin", iconUrl });
        }
      }
    }
    await scanPluginDir(pluginCache).catch(() => {});

    return skills.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "system" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  /**
   * One-shot non-interactive command. Captures stdout+stderr up to `timeoutMs`
   * (default 10s), then returns { exitCode, stdout, stderr }. Useful for
   * provider checks like `codex --version`.
   */
  async "exec.run"({ cmd, args, cwd, env, timeoutMs }, _ctx) {
    if (!cmd) throw new Error("exec.run: cmd is required");
    let resolvedCwd: string;
    try {
      resolvedCwd = cwd ? safeResolve(String(cwd)) : root;
    } catch {
      resolvedCwd = root;
    }
    const mergedEnv = safeEnv((env as Record<string, string> | undefined) ?? {});
    const proc = cpSpawn(String(cmd), Array.isArray(args) ? (args as string[]) : [], {
      cwd: resolvedCwd,
      env: mergedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const limit = typeof timeoutMs === "number" ? timeoutMs : 10_000;
    const killer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, limit);

    const collect = (stream: NodeJS.ReadableStream | null): Promise<string> =>
      new Promise((resolve) => {
        if (!stream) return resolve("");
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", () => resolve(""));
      });

    const [stdout, stderr, code] = await Promise.all([
      collect(proc.stdout),
      collect(proc.stderr),
      new Promise<number | null>((resolve) => proc.on("exit", (c) => resolve(c))),
    ]);
    clearTimeout(killer);
    return { exitCode: code, stdout, stderr };
  },

  // ─── MCP RPC ──────────────────────────────────────────────────────────────

  async "mcp.list"(_params) {
    type McpRawEntry = {
      command?: string;
      url?: string;
      transport?: string;
      description?: string;
      args?: string[];
      [k: string]: unknown;
    };
    type McpFileShape = {
      mcpServers?: Record<string, McpRawEntry>;
    };

    const home = process.env.HOME ?? "/root";
    const candidates = [
      path.join(home, ".config", "claude", "mcp.json"),
      path.join(home, ".codex", "mcp.json"),
      path.join(root, ".codex-home", "mcp.json"),
      path.join(root, ".mcp.json"),
    ];

    const seen = new Map<
      string,
      {
        id: string;
        transport: "stdio" | "http" | "ws";
        command?: string;
        url?: string;
        status: "configured";
        source: string;
        description?: string;
      }
    >();

    for (const filePath of candidates) {
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }
      let parsed: McpFileShape;
      try {
        parsed = JSON.parse(raw) as McpFileShape;
      } catch {
        continue;
      }
      const servers = parsed.mcpServers ?? {};
      for (const [id, entry] of Object.entries(servers)) {
        if (seen.has(id)) continue;
        let transport: "stdio" | "http" | "ws" = "stdio";
        if (entry.transport === "http") transport = "http";
        else if (entry.transport === "ws") transport = "ws";
        else if (entry.url) {
          const u = entry.url.toLowerCase();
          transport = u.startsWith("ws") ? "ws" : "http";
        }
        seen.set(id, {
          id,
          transport,
          ...(entry.command !== undefined ? { command: entry.command } : {}),
          ...(entry.url !== undefined ? { url: entry.url } : {}),
          status: "configured",
          source: filePath,
          ...(entry.description !== undefined ? { description: entry.description } : {}),
        });
      }
    }

    return Array.from(seen.values());
  },

  async "mcp.state"(_params) {
    const home = process.env.HOME ?? "/root";
    const stateFile = path.join(home, ".ide-ux-agentik", "mcp-state.json");
    try {
      const raw = await fs.readFile(stateFile, "utf8");
      const parsed = JSON.parse(raw) as { enabled?: unknown };
      const enabled = Array.isArray(parsed.enabled)
        ? (parsed.enabled as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      return { enabled };
    } catch {
      return { enabled: [] };
    }
  },

  async "mcp.enable"({ id: rawId }) {
    const id = String(rawId ?? "").trim();
    if (!id) throw new Error("mcp.enable: id is required");
    const home = process.env.HOME ?? "/root";
    const stateDir = path.join(home, ".ide-ux-agentik");
    const stateFile = path.join(stateDir, "mcp-state.json");
    let enabled: string[] = [];
    try {
      const raw = await fs.readFile(stateFile, "utf8");
      const parsed = JSON.parse(raw) as { enabled?: unknown };
      enabled = Array.isArray(parsed.enabled)
        ? (parsed.enabled as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      enabled = [];
    }
    if (!enabled.includes(id)) enabled.push(id);
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ enabled }, null, 2), "utf8");
    return { ok: true, enabled };
  },

  async "mcp.disable"({ id: rawId }) {
    const id = String(rawId ?? "").trim();
    if (!id) throw new Error("mcp.disable: id is required");
    const home = process.env.HOME ?? "/root";
    const stateDir = path.join(home, ".ide-ux-agentik");
    const stateFile = path.join(stateDir, "mcp-state.json");
    let enabled: string[] = [];
    try {
      const raw = await fs.readFile(stateFile, "utf8");
      const parsed = JSON.parse(raw) as { enabled?: unknown };
      enabled = Array.isArray(parsed.enabled)
        ? (parsed.enabled as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      enabled = [];
    }
    enabled = enabled.filter((x) => x !== id);
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ enabled }, null, 2), "utf8");
    return { ok: true, enabled };
  },
};

// Node HTTP server: serves the health probe and upgrades to WebSocket.
const httpServer = createServer((req, res) => {
  // Health probe used by the webapp footer (different origin in dev). CORS
  // intentionally open: the payload reveals only {service, root, ready} and
  // all authenticated work goes through the WebSocket + token.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
    });
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify({ service: "ide-ux-agentik-agent", root, ready: true }));
});

const wss = new WebSocketServer({ server: httpServer });

type WsContext = Ctx & { authTimeout?: NodeJS.Timeout };
const contexts = new WeakMap<WebSocket, WsContext>();

wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
  const ctx: WsContext = {
    authed: false,
    watchers: new Map<string, FSWatcher>(),
    ptySessions: new Map<string, PtySession>(),
    chatSessions: new Map<string, ChatSession>(),
    ws: { send: (d: string) => ws.send(d) },
  };
  contexts.set(ws, ctx);
  ctx.authTimeout = setTimeout(() => {
    if (!ctx.authed) ws.close(4401, "auth timeout");
  }, 5000);

  ws.on("message", async (raw) => {
    let msg: {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (!msg.method || (typeof msg.id !== "number" && typeof msg.id !== "string")) return;

    const handler = methods[msg.method];
    if (!handler) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "method not found" },
        }),
      );
      return;
    }
    if (!ctx.authed && msg.method !== "auth") {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32001, message: "unauthenticated" },
        }),
      );
      return;
    }
    try {
      const result = await handler(msg.params ?? {}, ctx);
      if (msg.method === "auth" && ctx.authTimeout) clearTimeout(ctx.authTimeout);
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
  });

  ws.on("close", () => {
    for (const w of ctx.watchers.values()) w.close();
    ctx.watchers.clear();
    for (const session of ctx.ptySessions.values()) {
      try {
        if (session.pty) session.pty.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    ctx.ptySessions.clear();
    for (const session of ctx.chatSessions.values()) {
      try {
        session.proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    ctx.chatSessions.clear();
    if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
  });
});

httpServer.listen(port, host);

console.log(`[agent] listening on ws://${host}:${port}  root=${root}  token=${token.slice(0, 6)}…`);
console.log(`[agent] connect from the webapp: wss://<public-host>:${port}  + token`);

// Generate a token if you need one:
if (process.env.AGENT_GENERATE_TOKEN) {
  console.log(`suggested token: ${randomUUID()}`);
}

function shutdown() {
  closeDb();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
