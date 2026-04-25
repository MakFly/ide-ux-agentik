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
  tasksRepo,
  taskLogsRepo,
  taskSessionsRepo,
  metaRepo,
  orgsRepo,
  usersRepo,
  workspacesRepo,
  type DbTask,
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
  "SSH_AUTH_SOCK",
  "GIT_SSH_COMMAND",
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
  claude: new Set([
    "--model",
    "--effort",
    "-p",
    "--output-format",
    "--verbose",
    "--include-partial-messages",
  ]),
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
        throw new Error(`task spawn: forbidden flag "${a}" for cli "${cli}"`);
      }
      out.push(a);
      // If the next token does not start with `-`, treat as value.
      if (i + 1 < args.length && !String(args[i + 1] ?? "").startsWith("-")) {
        out.push(String(args[++i]));
      }
    } else {
      // Bare value without preceding flag — reject.
      throw new Error(`task spawn: unexpected positional arg "${a}"`);
    }
  }
  return out;
}

function rowToWorkspace(row: import("./persistence/db.ts").DbWorkspaceRow) {
  let source: Record<string, unknown>;
  if (row.source_kind === "remote-agent") {
    source = {
      kind: "remote-agent",
      url: row.source_url,
      token: row.source_token,
      label: row.source_label,
    };
  } else if (row.source_kind === "local-web") {
    source = { kind: "local-web", handleId: row.source_handle_id, name: row.source_name };
  } else if (row.source_kind === "mock") {
    source = { kind: "mock", id: row.source_handle_id };
  } else {
    source = { kind: row.source_kind };
  }
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    letter: row.letter,
    color: row.color,
    gitUrl: row.git_url ?? undefined,
    rootPath: row.root_path ?? undefined,
    source,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

async function getRemoteDefaultBranch(gitRoot: string): Promise<string> {
  try {
    const { stdout } = await gitExec(["symbolic-ref", "refs/remotes/origin/HEAD"], gitRoot);
    const match = stdout.match(/refs\/remotes\/origin\/(.+)/);
    return match ? match[1] : "main";
  } catch {
    return "main";
  }
}

async function setupTaskWorktree(
  gitRoot: string,
  worktreePath: string,
  branchName: string,
  baseRef: string,
): Promise<void> {
  let attempt = 0;
  let finalBranchName = branchName;
  while (attempt < 3) {
    try {
      await gitExec(["worktree", "add", "-b", finalBranchName, worktreePath, baseRef], gitRoot);
      return;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("already exists")) {
        attempt++;
        finalBranchName = `${branchName}-${Date.now()}`;
      } else {
        throw e;
      }
    }
  }
  throw new Error(`setupTaskWorktree: failed after 3 retries`);
}

// Errors we treat as "already cleaned up" — logged at info level instead of
// warn, since they happen normally when the user removes a worktree twice or
// the branch was merged elsewhere.
const WORKTREE_GONE_MARKERS = [
  "is not a working tree",
  "n'est pas une copie de travail",
  "no such file or directory",
  "aucun fichier ou dossier",
];
const BRANCH_GONE_MARKERS = ["branch not found", "non trouvée", "not found"];

function matchesAny(msg: string, markers: string[]): boolean {
  const lower = msg.toLowerCase();
  return markers.some((m) => lower.includes(m.toLowerCase()));
}

async function autoCleanupFailedTask(
  gitRoot: string,
  taskId: string,
  worktreePath: string | null | undefined,
  branchName: string | null | undefined,
): Promise<void> {
  if (!worktreePath && !branchName) return;
  try {
    await removeTaskWorktree(gitRoot, worktreePath ?? "", branchName ?? "");
    console.info(`[task.autoCleanup] failed task ${taskId} worktree+branch removed`);
  } catch (e) {
    console.warn(`[task.autoCleanup] failed for ${taskId}: ${(e as Error).message}`);
  }
}

async function removeTaskWorktree(
  gitRoot: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  try {
    await gitExec(["worktree", "remove", "--force", worktreePath], gitRoot);
    console.info(`[task] worktree removed: ${worktreePath}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (matchesAny(msg, WORKTREE_GONE_MARKERS)) {
      console.info(`[task] worktree already gone: ${worktreePath}`);
    } else {
      console.warn(`[task] worktree remove failed (${worktreePath}): ${msg}`);
    }
  }
  try {
    await gitExec(["branch", "-D", branchName], gitRoot);
    console.info(`[task] branch deleted: ${branchName}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (matchesAny(msg, BRANCH_GONE_MARKERS)) {
      console.info(`[task] branch already gone: ${branchName}`);
    } else {
      console.warn(`[task] branch delete failed (${branchName}): ${msg}`);
    }
  }
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

type GitCloneSession = {
  id: string;
  proc: ChildProcess;
  alive: boolean;
  dest: string;
};

type TaskSession = {
  id: string;
  taskId: string;
  sessionId: string;
  proc: ChildProcess;
  alive: boolean;
};

type Ctx = {
  authed: boolean;
  watchers: Map<string, FSWatcher>;
  ptySessions: Map<string, PtySession>;
  chatSessions: Map<string, ChatSession>;
  gitCloneSessions: Map<string, GitCloneSession>;
  taskSessions: Map<string, TaskSession>;
  runningTasks: Set<string>;
  pendingTasks: string[];
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

let globalCtx: Ctx | null = null;

function drainPendingTasks() {
  if (!globalCtx || globalCtx.runningTasks.size >= 3) return;
  const next = globalCtx.pendingTasks.shift();
  if (!next) return;
  methods["task.start"]({ id: next }, globalCtx).catch((e) =>
    console.error("[task] drain error:", e),
  );
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

  async "git.clone"({ url, dest, env }, ctx) {
    const repoUrl = String(url ?? "").trim();
    const destPath = String(dest ?? "").trim();

    if (!repoUrl) throw new Error("git.clone: url is required");
    if (!destPath) throw new Error("git.clone: dest is required");

    const urlRegex = /^(https:\/\/|git@|ssh:\/\/)/;
    if (!urlRegex.test(repoUrl)) {
      throw new Error(
        `git.clone: invalid url scheme (must be https://, git@, or ssh://): ${repoUrl}`,
      );
    }

    const homeDir = process.env.HOME || "/root";
    const resolved = path.isAbsolute(destPath)
      ? path.resolve(destPath)
      : path.resolve(homeDir, destPath);
    if (!resolved.startsWith(homeDir)) {
      throw new Error(`git.clone: dest must be under HOME directory: ${destPath}`);
    }
    if (resolved.includes("..")) {
      throw new Error(`git.clone: dest cannot contain ..: ${destPath}`);
    }

    let exists = false;
    try {
      await fs.stat(resolved);
      exists = true;
    } catch {
      /* does not exist yet */
    }
    if (exists) {
      throw new Error(`git.clone: dest already exists: ${resolved}`);
    }

    const mergedEnv = safeEnv((env as Record<string, string> | undefined) ?? {});
    mergedEnv.GIT_TERMINAL_PROMPT = "0";

    const id = randomUUID();
    const parentDir = path.dirname(resolved);
    const proc = cpSpawn("git", ["clone", "--progress", repoUrl, resolved], {
      cwd: parentDir,
      env: mergedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const session: GitCloneSession = { id, proc, alive: true, dest: resolved };
    ctx.gitCloneSessions.set(id, session);

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "git.clone.progress",
          params: { id, stream: "stdout", data: chunk },
        }),
      );
    });

    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "git.clone.progress",
          params: { id, stream: "stderr", data: chunk },
        }),
      );
    });

    proc.on("exit", (code, signal) => {
      if (!session.alive) return;
      session.alive = false;
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "git.clone.end",
          params: { id, code, dest: resolved },
        }),
      );
      ctx.gitCloneSessions.delete(id);
    });

    proc.on("error", (err) => {
      if (!session.alive) return;
      session.alive = false;
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "git.clone.progress",
          params: { id, stream: "stderr", data: err.message },
        }),
      );
      ctx.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "git.clone.end",
          params: { id, code: null, dest: resolved },
        }),
      );
      ctx.gitCloneSessions.delete(id);
    });

    return { id, dest: resolved };
  },

  async "git.clone.cancel"({ id }, ctx) {
    const session = ctx.gitCloneSessions.get(String(id));
    if (!session) throw new Error(`git.clone session not found: ${id}`);
    try {
      session.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    session.alive = false;
    ctx.gitCloneSessions.delete(String(id));
    return { ok: true };
  },

  async "git.detectInstall"({ dir }) {
    const dirPath = String(dir ?? "").trim();
    if (!dirPath) throw new Error("git.detectInstall: dir is required");

    const resolved = path.resolve(dirPath);
    const homeDir = process.env.HOME || "/root";
    if (!resolved.startsWith(homeDir)) {
      throw new Error(`git.detectInstall: dir must be under HOME directory: ${dirPath}`);
    }
    if (resolved.includes("..")) {
      throw new Error(`git.detectInstall: dir cannot contain ..: ${dirPath}`);
    }

    try {
      await fs.stat(resolved);
    } catch {
      return null;
    }

    const probes = [
      { file: "bun.lockb", tool: "bun", args: ["install"] },
      { file: "bun.lock", tool: "bun", args: ["install"] },
      { file: "pnpm-lock.yaml", tool: "pnpm", args: ["install"] },
      { file: "yarn.lock", tool: "yarn", args: ["install"] },
      { file: "package-lock.json", tool: "npm", args: ["install"] },
      { file: "pyproject.toml", tool: "uv", args: ["sync"] },
      { file: "Cargo.toml", tool: "cargo", args: ["build"] },
      { file: "go.mod", tool: "go", args: ["mod", "download"] },
    ];

    for (const probe of probes) {
      try {
        await fs.stat(path.join(resolved, probe.file));
        return { tool: probe.tool, args: probe.args };
      } catch {
        /* not found, continue */
      }
    }

    try {
      await fs.stat(path.join(resolved, "package.json"));
      return { tool: "bun", args: ["install"] };
    } catch {
      /* no package.json either */
    }

    return null;
  },

  // ─── Task RPC ──────────────────────────────────────────────────────────────

  async "task.create"(
    { workspaceId, title, prompt, cli, model, effort, baseRef, parentSessionId },
    _ctx,
  ) {
    const wid = String(workspaceId ?? "").trim();
    const t = String(title ?? "").trim();
    const p = String(prompt ?? "").trim();
    const c = String(cli ?? "").trim();
    const m = model !== undefined && model !== null ? String(model).trim() || undefined : undefined;
    const eff =
      effort !== undefined && effort !== null ? String(effort).trim() || undefined : undefined;
    if (!wid) throw new Error("task.create: workspaceId is required");
    if (!t) throw new Error("task.create: title is required");
    if (!p) throw new Error("task.create: prompt is required");
    if (!c) throw new Error("task.create: cli is required");
    if (!ALLOWED_CHAT_FLAGS[c]) throw new Error(`task.create: unsupported cli "${c}"`);

    const taskId = randomUUID();
    const sessionId = randomUUID();

    console.info(
      `[task.create] id=${taskId} sessionId=${sessionId} ws=${wid} cli=${c} model=${m ?? "(default)"} effort=${eff ?? "(default)"} title="${t.slice(0, 60)}"`,
    );

    // Create session first to avoid FK violation when creating task
    sessionsRepo.create({
      id: sessionId,
      workspaceId: wid,
      cli: c,
      title: t,
    });

    const createdTask = tasksRepo.create({
      id: taskId,
      workspaceId: wid,
      title: t,
      prompt: p,
      cli: c,
      model: m,
      effort: eff,
      parentSessionId: parentSessionId !== undefined ? String(parentSessionId) : undefined,
      sessionId,
    });

    // Attach the primary session to the task.
    taskSessionsRepo.attach(taskId, sessionId, "primary");

    broadcastAuthed({
      jsonrpc: "2.0",
      method: "task.created",
      params: { task: createdTask, sessionId },
    });

    return { id: taskId, sessionId };
  },

  async "task.list"({ workspaceId, status }, _ctx) {
    const wid = String(workspaceId ?? "").trim();
    if (!wid) throw new Error("task.list: workspaceId is required");
    const opts = status ? { status: String(status) as DbTask["status"] } : undefined;
    return tasksRepo.list(wid, opts);
  },

  async "task.logs.list"({ taskId, since, limit }, _ctx) {
    const tid = String(taskId ?? "").trim();
    if (!tid) throw new Error("task.logs.list: taskId is required");
    return taskLogsRepo.list(tid, {
      since: typeof since === "number" ? since : undefined,
      limit: typeof limit === "number" ? Math.min(limit, 5000) : 1000,
    });
  },

  async "task.sessionList"({ taskId }, _ctx) {
    const tid = String(taskId ?? "").trim();
    if (!tid) throw new Error("task.sessionList: taskId is required");

    const rows = taskSessionsRepo.list(tid);
    return Promise.all(
      rows.map(async (row) => {
        const session = sessionsRepo.getById(row.session_id);
        return {
          sessionId: row.session_id,
          role: row.role,
          createdAt: row.created_at,
          closedAt: row.closed_at,
          cli: session?.cli ?? "unknown",
        };
      }),
    );
  },

  async "task.attachSession"({ taskId, cli, model, effort }, ctx) {
    const tid = String(taskId ?? "").trim();
    const c = String(cli ?? "").trim();
    const m = model !== undefined && model !== null ? String(model).trim() || undefined : undefined;
    const eff =
      effort !== undefined && effort !== null ? String(effort).trim() || undefined : undefined;

    if (!tid) throw new Error("task.attachSession: taskId is required");
    if (!c) throw new Error("task.attachSession: cli is required");
    if (!ALLOWED_CHAT_FLAGS[c]) throw new Error(`task.attachSession: unsupported cli "${c}"`);

    const task = tasksRepo.get(tid);
    if (!task) throw new Error(`task.attachSession: task not found: ${tid}`);

    if (!task.worktree_path || !task.branch_name) {
      throw new Error(`task.attachSession: task worktree not ready for task ${tid}`);
    }

    const sessionId = randomUUID();
    console.info(`[task.attachSession] id=${tid} sessionId=${sessionId} cli=${c}`);

    // Create session for the peer CLI.
    sessionsRepo.create({
      id: sessionId,
      workspaceId: task.workspace_id,
      cli: c,
      title: `${task.title} (${c})`,
    });

    // Attach to task as peer.
    taskSessionsRepo.attach(tid, sessionId, "peer");

    // Spawn the peer CLI in the same worktree.
    const worktreePath = task.worktree_path;
    const safeExtra: string[] = [];
    if (m) {
      safeExtra.push("--model", m);
    }
    if (eff) {
      if (c === "codex") {
        safeExtra.push("-c", `model_reasoning_effort=${eff}`);
      } else {
        safeExtra.push("--effort", eff);
      }
    }

    let execCmd: string;
    let execArgs: string[];
    if (c === "codex") {
      execCmd = "codex";
      execArgs = ["exec", "--json", ...safeExtra];
    } else if (c === "claude") {
      execCmd = "claude";
      execArgs = ["-p", "", "--output-format", "stream-json", "--verbose", ...safeExtra];
    } else {
      throw new Error(`unsupported cli "${c}"`);
    }

    const mergedEnv = safeEnv();

    console.info(
      `[task.attachSession] id=${tid} sessionId=${sessionId} exec="${execCmd} ${execArgs.slice(0, 3).join(" ")}…" cwd=${worktreePath}`,
    );
    const proc = cpSpawn(execCmd, execArgs, {
      cwd: worktreePath,
      env: mergedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const taskSession: TaskSession = { id: sessionId, taskId: tid, sessionId, proc, alive: true };
    ctx.taskSessions.set(sessionId, taskSession);

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
        broadcastAuthed({
          jsonrpc: "2.0",
          method: "task.event",
          params: { taskId: tid, event: evt },
        });
        taskLogsRepo.append(tid, "info", "stdout", evt);
      }
    });

    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      broadcastAuthed({
        jsonrpc: "2.0",
        method: "task.event",
        params: { taskId: tid, event: { type: "stderr", text: chunk } },
      });
      taskLogsRepo.append(tid, "warn", "stderr", { text: chunk });
    });

    proc.on("exit", (code, signal) => {
      if (!taskSession.alive) return;
      taskSession.alive = false;

      if (buf.trim()) {
        try {
          const evt = JSON.parse(buf.trim());
          broadcastAuthed({
            jsonrpc: "2.0",
            method: "task.event",
            params: { taskId: tid, event: evt },
          });
          taskLogsRepo.append(tid, "info", "stdout", evt);
        } catch {
          /* ignore malformed trailing line */
        }
        buf = "";
      }

      console.info(
        `[task.attachSession.exit] id=${tid} sessionId=${sessionId} code=${code} signal=${signal ?? "none"}`,
      );
      taskSessionsRepo.detach(sessionId);

      ctx.taskSessions.delete(sessionId);
    });

    proc.on("error", (err) => {
      if (!taskSession.alive) return;
      taskSession.alive = false;
      const errorMsg = err.message;
      console.error(`[task.attachSession] proc error id=${tid}: ${errorMsg}`);
      broadcastAuthed({
        jsonrpc: "2.0",
        method: "task.event",
        params: { taskId: tid, event: { type: "error", message: errorMsg } },
      });
      taskLogsRepo.append(tid, "error", "spawn", { message: errorMsg });

      taskSessionsRepo.detach(sessionId);
      ctx.taskSessions.delete(sessionId);
    });

    broadcastAuthed({
      jsonrpc: "2.0",
      method: "task.sessionAttached",
      params: { taskId: tid, sessionId, role: "peer", cli: c },
    });

    return { taskId: tid, sessionId, role: "peer" };
  },

  async "task.start"({ id }, ctx) {
    const taskId = String(id ?? "").trim();
    if (!taskId) throw new Error("task.start: id is required");

    const task = tasksRepo.get(taskId);
    if (!task) throw new Error(`task.start: task not found: ${taskId}`);

    if (ctx.runningTasks.size >= 3) {
      ctx.pendingTasks.push(taskId);
      tasksRepo.update(taskId, { status: "awaiting" });
      console.info(`[task.start] queued id=${taskId} (concurrency cap reached: 3)`);
      broadcastAuthed({
        jsonrpc: "2.0",
        method: "task.queued",
        params: { taskId, reason: "concurrency limit (3 running)" },
      });
      return { status: "queued" };
    }

    ctx.runningTasks.add(taskId);
    tasksRepo.update(taskId, { status: "running", started_at: Date.now() });
    console.info(`[task.start] running id=${taskId}`);

    broadcastAuthed({
      jsonrpc: "2.0",
      method: "task.started",
      params: { taskId },
    });

    const spawnTaskAsync = async () => {
      try {
        const currentTask = tasksRepo.get(taskId);
        if (!currentTask) {
          ctx.runningTasks.delete(taskId);
          drainPendingTasks();
          return;
        }

        const gitRoot = root;
        const worktreePath = path.join(root, ".multica", "tasks", taskId);
        const branchName = `task/${slugify(currentTask.title)}-${taskId.slice(0, 8)}`;
        const baseRef = currentTask.base_ref || (await getRemoteDefaultBranch(gitRoot));

        console.info(
          `[task.spawn] id=${taskId} worktree=${worktreePath} branch=${branchName} baseRef=${baseRef}`,
        );
        try {
          await setupTaskWorktree(gitRoot, worktreePath, branchName, baseRef);
        } catch (e) {
          const errorMsg = (e as Error).message;
          console.error(`[task.spawn] worktree setup FAILED id=${taskId}: ${errorMsg}`);
          tasksRepo.update(taskId, {
            status: "failed",
            error_message: errorMsg,
            ended_at: Date.now(),
          });
          broadcastAuthed({
            jsonrpc: "2.0",
            method: "task.ended",
            params: { taskId, status: "failed", exitCode: null, errorMessage: errorMsg },
          });
          await autoCleanupFailedTask(gitRoot, taskId, worktreePath, branchName);
          ctx.runningTasks.delete(taskId);
          drainPendingTasks();
          return;
        }

        tasksRepo.update(taskId, {
          worktree_path: worktreePath,
          branch_name: branchName,
          base_ref: baseRef,
        });

        const cliKind = currentTask.cli;
        const text = currentTask.prompt;
        const safeExtra: string[] = [];
        if (currentTask.model) {
          safeExtra.push("--model", currentTask.model);
        }
        if (currentTask.effort) {
          // Codex uses -c model_reasoning_effort; Claude uses --effort directly.
          if (cliKind === "codex") {
            safeExtra.push("-c", `model_reasoning_effort=${currentTask.effort}`);
          } else {
            safeExtra.push("--effort", currentTask.effort);
          }
        }

        let execCmd: string;
        let execArgs: string[];
        if (cliKind === "codex") {
          execCmd = "codex";
          execArgs = ["exec", "--json", ...safeExtra, text];
        } else if (cliKind === "claude") {
          execCmd = "claude";
          execArgs = ["-p", text, "--output-format", "stream-json", "--verbose", ...safeExtra];
        } else {
          throw new Error(`unsupported cli "${cliKind}"`);
        }

        const mergedEnv = safeEnv();
        // Session already exists from task.create — retrieve it instead of creating
        const sessionId = currentTask.session_id;
        if (!sessionId) {
          throw new Error(
            `[task.spawn] session_id missing for task ${taskId} — task.create should have created it atomically`,
          );
        }

        console.info(
          `[task.spawn] id=${taskId} sessionId=${sessionId} exec="${execCmd} ${execArgs.slice(0, 3).join(" ")}…" cwd=${worktreePath}`,
        );
        const proc = cpSpawn(execCmd, execArgs, {
          cwd: worktreePath,
          env: mergedEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const taskSession: TaskSession = { id: sessionId, taskId, sessionId, proc, alive: true };
        ctx.taskSessions.set(sessionId, taskSession);

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
            broadcastAuthed({
              jsonrpc: "2.0",
              method: "task.event",
              params: { taskId, event: evt },
            });
            taskLogsRepo.append(taskId, "info", "stdout", evt);
          }
        });

        proc.stderr?.setEncoding("utf8");
        proc.stderr?.on("data", (chunk: string) => {
          broadcastAuthed({
            jsonrpc: "2.0",
            method: "task.event",
            params: { taskId, event: { type: "stderr", text: chunk } },
          });
          taskLogsRepo.append(taskId, "warn", "stderr", { text: chunk });
        });

        proc.on("exit", (code, signal) => {
          if (!taskSession.alive) return;
          taskSession.alive = false;

          if (buf.trim()) {
            try {
              const evt = JSON.parse(buf.trim());
              broadcastAuthed({
                jsonrpc: "2.0",
                method: "task.event",
                params: { taskId, event: evt },
              });
              taskLogsRepo.append(taskId, "info", "stdout", evt);
            } catch {
              /* ignore malformed trailing line */
            }
            buf = "";
          }

          const finalStatus =
            code === 0 || signal === null ? ("done" as const) : ("failed" as const);
          console.info(
            `[task.exit] id=${taskId} status=${finalStatus} code=${code} signal=${signal ?? "none"}`,
          );
          tasksRepo.update(taskId, {
            status: finalStatus,
            exit_code: code ?? undefined,
            ended_at: Date.now(),
          });

          broadcastAuthed({
            jsonrpc: "2.0",
            method: "task.ended",
            params: { taskId, status: finalStatus, exitCode: code, errorMessage: signal },
          });

          if (finalStatus === "failed") {
            void autoCleanupFailedTask(gitRoot, taskId, worktreePath, branchName);
          }

          ctx.taskSessions.delete(sessionId);
          ctx.runningTasks.delete(taskId);
          drainPendingTasks();
        });

        proc.on("error", (err) => {
          if (!taskSession.alive) return;
          taskSession.alive = false;
          const errorMsg = err.message;
          console.error(`[task.spawn] proc error id=${taskId}: ${errorMsg}`);
          broadcastAuthed({
            jsonrpc: "2.0",
            method: "task.event",
            params: { taskId, event: { type: "error", message: errorMsg } },
          });
          taskLogsRepo.append(taskId, "error", "spawn", { message: errorMsg });

          tasksRepo.update(taskId, {
            status: "failed",
            error_message: errorMsg,
            ended_at: Date.now(),
          });

          broadcastAuthed({
            jsonrpc: "2.0",
            method: "task.ended",
            params: { taskId, status: "failed", exitCode: null, errorMessage: errorMsg },
          });

          void autoCleanupFailedTask(gitRoot, taskId, worktreePath, branchName);

          ctx.taskSessions.delete(sessionId);
          ctx.runningTasks.delete(taskId);
          drainPendingTasks();
        });
      } catch (e) {
        const errorMsg = (e as Error).message;
        console.error(`[task.spawn] uncaught FAILED id=${taskId}: ${errorMsg}`);
        const t = tasksRepo.get(taskId);
        tasksRepo.update(taskId, {
          status: "failed",
          error_message: errorMsg,
          ended_at: Date.now(),
        });
        broadcastAuthed({
          jsonrpc: "2.0",
          method: "task.ended",
          params: { taskId, status: "failed", exitCode: null, errorMessage: errorMsg },
        });
        if (t?.worktree_path || t?.branch_name) {
          void autoCleanupFailedTask(root, taskId, t?.worktree_path, t?.branch_name);
        }
        ctx.runningTasks.delete(taskId);
        drainPendingTasks();
      }
    };

    spawnTaskAsync().catch((e) => console.error(`[task.spawn] async error id=${taskId}:`, e));

    return { status: "started" };
  },

  async "task.cancel"({ id }, ctx) {
    const taskId = String(id ?? "").trim();
    if (!taskId) throw new Error("task.cancel: id is required");

    const task = tasksRepo.get(taskId);
    if (!task) throw new Error(`task.cancel: task not found: ${taskId}`);

    console.info(`[task.cancel] id=${taskId} prev_status=${task.status}`);

    if (task.session_id) {
      const session = ctx.taskSessions.get(task.session_id);
      if (session) {
        try {
          session.proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        session.alive = false;
        ctx.taskSessions.delete(task.session_id);
      }
    }

    tasksRepo.update(taskId, {
      status: "cancelled",
      ended_at: Date.now(),
    });

    broadcastAuthed({
      jsonrpc: "2.0",
      method: "task.ended",
      params: { taskId, status: "cancelled", exitCode: null },
    });

    ctx.runningTasks.delete(taskId);
    drainPendingTasks();

    return { ok: true };
  },

  async "task.removeWorktree"({ id }, ctx) {
    const taskId = String(id ?? "").trim();
    if (!taskId) throw new Error("task.removeWorktree: id is required");

    const task = tasksRepo.get(taskId);
    if (!task) throw new Error(`task.removeWorktree: task not found: ${taskId}`);

    console.info(
      `[task.removeWorktree] id=${taskId} worktree=${task.worktree_path ?? "(none)"} branch=${task.branch_name ?? "(none)"}`,
    );

    if (task.worktree_path && task.branch_name) {
      await removeTaskWorktree(root, task.worktree_path, task.branch_name);
    }

    // Delete the row too — UX says "Remove worktree" means the task is gone
    // for good. Session cascades via tasks.session_id FK ON DELETE CASCADE,
    // and logs cascade via task_logs FK ON DELETE CASCADE.
    tasksRepo.delete(taskId);
    console.info(`[task.removeWorktree] db row deleted id=${taskId}`);

    broadcastAuthed({
      jsonrpc: "2.0",
      method: "task.worktreeRemoved",
      params: { taskId },
    });

    return { ok: true };
  },

  async "task.update"({ taskId, patch }) {
    const tid = String(taskId ?? "").trim();
    if (!tid) throw new Error("task.update: taskId is required");
    if (!patch || typeof patch !== "object") throw new Error("task.update: patch is required");
    const p = patch as Record<string, unknown>;
    tasksRepo.update(tid, {
      session_id: p.sessionId !== undefined ? String(p.sessionId) : undefined,
    });
    return { ok: true };
  },

  // ─── Persistence RPC ──────────────────────────────────────────────────────

  async "system.dbStamp"() {
    return { stamp: metaRepo.getDbStamp() };
  },

  // ─── Org / User / Workspaces (single source of truth — no localStorage) ───

  async "org.get"() {
    const row = orgsRepo.get();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logo_url ?? undefined,
      createdAt: row.created_at,
    };
  },

  async "org.put"({ org }) {
    if (!org || typeof org !== "object") throw new Error("org.put: org payload required");
    const o = org as {
      id: string;
      name: string;
      slug: string;
      logoUrl?: string;
      createdAt: number;
    };
    const row = orgsRepo.put(o);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logo_url ?? undefined,
      createdAt: row.created_at,
    };
  },

  async "user.get"() {
    const row = usersRepo.get();
    if (!row) return null;
    return {
      id: row.id,
      displayName: row.display_name,
      email: row.email ?? undefined,
      defaultAgent: row.default_agent,
    };
  },

  async "user.put"({ user }) {
    if (!user || typeof user !== "object") throw new Error("user.put: user payload required");
    const u = user as {
      id: string;
      displayName: string;
      email?: string;
      defaultAgent: string;
    };
    const row = usersRepo.put(u);
    return {
      id: row.id,
      displayName: row.display_name,
      email: row.email ?? undefined,
      defaultAgent: row.default_agent,
    };
  },

  async "workspaces.list"({ orgId }) {
    const oid = String(orgId ?? "").trim();
    if (!oid) throw new Error("workspaces.list: orgId is required");
    return workspacesRepo.list(oid).map((row) => rowToWorkspace(row));
  },

  async "workspaces.put"({ workspace }) {
    if (!workspace || typeof workspace !== "object")
      throw new Error("workspaces.put: workspace payload required");
    const w = workspace as Record<string, unknown>;
    const src = (w.source ?? {}) as Record<string, unknown>;
    const row = workspacesRepo.put({
      id: String(w.id ?? "").trim(),
      orgId: String(w.orgId ?? "").trim(),
      name: String(w.name ?? "").trim(),
      letter: String(w.letter ?? "").trim(),
      color: String(w.color ?? "").trim(),
      gitUrl: w.gitUrl !== undefined ? String(w.gitUrl) : undefined,
      rootPath: w.rootPath !== undefined ? String(w.rootPath) : undefined,
      source: {
        kind: String(src.kind ?? "").trim(),
        url: src.url !== undefined ? String(src.url) : undefined,
        token: src.token !== undefined ? String(src.token) : undefined,
        label: src.label !== undefined ? String(src.label) : undefined,
        handleId: src.handleId !== undefined ? String(src.handleId) : undefined,
        name: src.name !== undefined ? String(src.name) : undefined,
      },
    });
    return rowToWorkspace(row);
  },

  async "workspaces.delete"({ id }) {
    const wid = String(id ?? "").trim();
    if (!wid) throw new Error("workspaces.delete: id is required");
    return workspacesRepo.delete(wid);
  },

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

  async "messages.deleteForSession"({ sessionId }) {
    const sid = String(sessionId ?? "").trim();
    if (!sid) throw new Error("messages.deleteForSession: sessionId is required");
    const db = openDb();
    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sid);
    return { ok: true };
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

  /**
   * mcp.list — scan all known MCP config locations and return a merged list.
   *
   * Universal format {"mcpServers":{...}} shared by Cursor, Claude Desktop,
   * and Claude Code — see R3 audit §2
   * (https://modelcontextprotocol.io/docs/concepts/configuration).
   *
   * Scanned paths (first-wins per id):
   *   agentik-global    ~/.config/agentik/mcp.json   (writable via mcp.save)
   *   agentik-workspace <root>/.agentik/mcp.json      (writable via mcp.save)
   *   claude            ~/.config/claude/mcp.json
   *   codex             ~/.codex/mcp.json
   *   codex-home        <root>/.codex-home/mcp.json
   *   workspace-root    <root>/.mcp.json
   */
  async "mcp.list"(_params) {
    type McpRawEntry = {
      command?: string;
      url?: string;
      transport?: string;
      description?: string;
      args?: string[];
      env?: Record<string, string>;
      [k: string]: unknown;
    };
    type McpFileShape = {
      mcpServers?: Record<string, McpRawEntry>;
    };

    const home = process.env.HOME ?? "/root";
    // Agentik-managed paths are listed first so they win the seen-map (first-wins).
    const candidates: { filePath: string; scope?: "global" | "workspace" }[] = [
      { filePath: path.join(home, ".config", "agentik", "mcp.json"), scope: "global" },
      { filePath: path.join(root, ".agentik", "mcp.json"), scope: "workspace" },
      { filePath: path.join(home, ".config", "claude", "mcp.json") },
      { filePath: path.join(home, ".codex", "mcp.json") },
      { filePath: path.join(root, ".codex-home", "mcp.json") },
      { filePath: path.join(root, ".mcp.json") },
    ];

    const seen = new Map<
      string,
      {
        id: string;
        transport: "stdio" | "http" | "ws" | "sse";
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        status: "configured";
        source: string;
        scope?: "global" | "workspace";
        description?: string;
      }
    >();

    for (const { filePath, scope } of candidates) {
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
        let transport: "stdio" | "http" | "ws" | "sse" = "stdio";
        if (entry.transport === "http") transport = "http";
        else if (entry.transport === "sse") transport = "sse";
        else if (entry.transport === "ws") transport = "ws";
        else if (entry.url) {
          const u = entry.url.toLowerCase();
          transport = u.startsWith("ws") ? "ws" : "http";
        }
        seen.set(id, {
          id,
          transport,
          ...(entry.command !== undefined ? { command: entry.command } : {}),
          ...(Array.isArray(entry.args) ? { args: entry.args as string[] } : {}),
          ...(entry.env && typeof entry.env === "object" ? { env: entry.env } : {}),
          ...(entry.url !== undefined ? { url: entry.url } : {}),
          status: "configured",
          source: filePath,
          ...(scope !== undefined ? { scope } : {}),
          ...(entry.description !== undefined ? { description: entry.description } : {}),
        });
      }
    }

    return Array.from(seen.values());
  },

  /**
   * mcp.save — write entries to the agentik-managed config file.
   * scope "global"    → ~/.config/agentik/mcp.json
   * scope "workspace" → <root>/.agentik/mcp.json
   *
   * Merges with any existing entries in that file (does not touch other scopes).
   */
  async "mcp.save"({ scope: rawScope, entries: rawEntries }) {
    const scope = String(rawScope ?? "").trim();
    if (scope !== "global" && scope !== "workspace") {
      throw new Error('mcp.save: scope must be "global" or "workspace"');
    }
    if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) {
      throw new Error("mcp.save: entries must be an object");
    }
    const entries = rawEntries as Record<string, Record<string, unknown>>;

    // Validate each entry id and structure (manual Zod-style, no dep).
    const ID_RE = /^[a-z0-9_-]+$/;
    for (const [id, entry] of Object.entries(entries)) {
      if (!ID_RE.test(id)) {
        throw new Error(`mcp.save: invalid entry id "${id}" — must match /^[a-z0-9_-]+$/`);
      }
      if (!entry || typeof entry !== "object") {
        throw new Error(`mcp.save: entry "${id}" must be an object`);
      }
      const hasCommand = "command" in entry && typeof entry.command === "string";
      const hasUrl = "url" in entry && typeof entry.url === "string";
      if (!hasCommand && !hasUrl) {
        throw new Error(
          `mcp.save: entry "${id}" must have either command (stdio) or url (http/sse)`,
        );
      }
      if ("transport" in entry && entry.transport !== undefined) {
        if (!["stdio", "http", "sse"].includes(String(entry.transport))) {
          throw new Error(`mcp.save: entry "${id}" transport must be stdio | http | sse`);
        }
      }
      if ("args" in entry && entry.args !== undefined && !Array.isArray(entry.args)) {
        throw new Error(`mcp.save: entry "${id}" args must be an array`);
      }
      if ("env" in entry && entry.env !== undefined) {
        if (typeof entry.env !== "object" || Array.isArray(entry.env)) {
          throw new Error(`mcp.save: entry "${id}" env must be an object`);
        }
      }
    }

    const home = process.env.HOME ?? "/root";
    const configPath =
      scope === "global"
        ? path.join(home, ".config", "agentik", "mcp.json")
        : path.join(root, ".agentik", "mcp.json");

    // Read existing file (if any) and merge.
    type McpFileShape = { mcpServers?: Record<string, unknown> };
    let existing: McpFileShape = {};
    try {
      existing = JSON.parse(await fs.readFile(configPath, "utf8")) as McpFileShape;
    } catch {
      existing = {};
    }
    const merged: Record<string, unknown> = { ...(existing.mcpServers ?? {}), ...entries };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ mcpServers: merged }, null, 2), "utf8");
    return { ok: true, path: configPath };
  },

  /**
   * mcp.remove — delete a single entry from an agentik-managed config file.
   * Only operates on global or workspace scope (read-only sources are not modified).
   */
  async "mcp.remove"({ scope: rawScope, id: rawId }) {
    const scope = String(rawScope ?? "").trim();
    if (scope !== "global" && scope !== "workspace") {
      throw new Error('mcp.remove: scope must be "global" or "workspace"');
    }
    const id = String(rawId ?? "").trim();
    if (!id) throw new Error("mcp.remove: id is required");

    const home = process.env.HOME ?? "/root";
    const configPath =
      scope === "global"
        ? path.join(home, ".config", "agentik", "mcp.json")
        : path.join(root, ".agentik", "mcp.json");

    type McpFileShape = { mcpServers?: Record<string, unknown> };
    let existing: McpFileShape = {};
    try {
      existing = JSON.parse(await fs.readFile(configPath, "utf8")) as McpFileShape;
    } catch {
      return { ok: true, path: configPath }; // nothing to remove
    }
    const servers = { ...(existing.mcpServers ?? {}) };
    delete servers[id];
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ mcpServers: servers }, null, 2), "utf8");
    return { ok: true, path: configPath };
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

function broadcastAuthed(payload: object) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState !== client.OPEN) continue;
    const cctx = contexts.get(client);
    if (!cctx?.authed) continue;
    try {
      client.send(data);
    } catch (err) {
      console.warn("[broadcastAuthed] send failed:", err);
    }
  }
}

wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
  const ctx: WsContext = {
    authed: false,
    watchers: new Map<string, FSWatcher>(),
    ptySessions: new Map<string, PtySession>(),
    chatSessions: new Map<string, ChatSession>(),
    gitCloneSessions: new Map<string, GitCloneSession>(),
    taskSessions: new Map<string, TaskSession>(),
    runningTasks: new Set<string>(),
    pendingTasks: [],
    ws: { send: (d: string) => ws.send(d) },
  };
  contexts.set(ws, ctx);
  globalCtx = ctx;
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
    for (const session of ctx.gitCloneSessions.values()) {
      try {
        session.proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    ctx.gitCloneSessions.clear();
    for (const session of ctx.taskSessions.values()) {
      try {
        session.proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    ctx.taskSessions.clear();
    if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
    if (globalCtx === ctx) globalCtx = null;
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
