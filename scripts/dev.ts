#!/usr/bin/env bun
/**
 * Dev orchestrator: spawns the Bun agent + Vite side-by-side so Codex/Claude/etc.
 * work out-of-the-box in the web build.
 *
 * - Generates a fresh random token per run.
 * - Injects VITE_DEV_AGENT_URL + VITE_DEV_AGENT_TOKEN into Vite's env so the UI
 *   auto-registers a `local-dev` remote-agent workspace on first load.
 * - Forwards SIGINT/SIGTERM to both children, dies cleanly.
 *
 * Tauri path: unused. The Tauri shell spawns CLIs via Rust `invoke` — no agent.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

const AGENT_HOST = process.env.AGENT_HOST ?? "127.0.0.1";
const AGENT_PORT = process.env.AGENT_PORT ?? "7421";
const AGENT_ROOT = path.resolve(process.env.AGENT_ROOT ?? process.cwd());
const AGENT_TOKEN = process.env.AGENT_TOKEN ?? randomBytes(24).toString("hex");
const AGENT_URL = `ws://${AGENT_HOST}:${AGENT_PORT}`;

const color = (c: number, s: string) => `\x1b[${c}m${s}\x1b[0m`;
const agentTag = color(33, "[agent]");
const viteTag = color(36, "[vite] ");

function banner() {
  console.log(color(90, "─".repeat(60)));
  console.log(`${color(1, "ide-ux-agentik")} ${color(90, "dev")}`);
  console.log(`  agent     ${AGENT_URL}`);
  console.log(`  token     ${AGENT_TOKEN.slice(0, 8)}…${color(90, " (auto, per-run)")}`);
  console.log(`  root      ${AGENT_ROOT}`);
  console.log(color(90, "─".repeat(60)));
}

function prefix(stream: NodeJS.WritableStream, tag: string, data: Buffer) {
  const lines = data.toString("utf8").split("\n");
  const last = lines.pop();
  for (const line of lines) stream.write(`${tag} ${line}\n`);
  if (last) stream.write(`${tag} ${last}`);
}

banner();

// IMPORTANT: the agent runs under Node (not Bun) because node-pty's IPC with
// PTY children breaks under Bun for some CLIs (codex exits with SIGHUP/0 bytes).
// Node 24 reads TypeScript natively via --experimental-strip-types.
const agent = spawn(
  "node",
  [
    "--experimental-strip-types",
    "--no-warnings",
    "agent/server.ts",
    "--root", AGENT_ROOT,
    "--host", AGENT_HOST,
    "--port", AGENT_PORT,
    "--token", AGENT_TOKEN,
  ],
  { stdio: ["ignore", "pipe", "pipe"], env: process.env },
);
agent.stdout.on("data", (d) => prefix(process.stdout, agentTag, d));
agent.stderr.on("data", (d) => prefix(process.stderr, agentTag, d));

const vite = spawn("vite", ["dev"], {
  stdio: ["inherit", "pipe", "pipe"],
  env: {
    ...process.env,
    VITE_DEV_AGENT_URL: AGENT_URL,
    VITE_DEV_AGENT_TOKEN: AGENT_TOKEN,
  },
});
vite.stdout.on("data", (d) => prefix(process.stdout, viteTag, d));
vite.stderr.on("data", (d) => prefix(process.stderr, viteTag, d));

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [agent, vite]) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function onExit(name: string, code: number | null, signal: NodeJS.Signals | null) {
  if (!shuttingDown) {
    console.error(`\n${color(31, "✕")} ${name} exited (code=${code} signal=${signal}) — stopping.`);
    shutdown("SIGTERM");
  }
}

agent.on("exit", (c, s) => onExit("agent", c, s));

vite.on("exit", async (c, s) => {
  onExit("vite", c, s);
  // Wait for the agent to actually exit (SIGTERM was sent by shutdown()).
  // Without this, process.exit kills the parent before the child responds,
  // leaving the agent as an orphan that keeps the port occupied.
  if (!agent.killed && agent.exitCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { agent.kill("SIGKILL"); } catch { /* ignore */ }
        resolve();
      }, 3000);
      agent.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  process.exit(c ?? 0);
});
