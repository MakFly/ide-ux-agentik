import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createReadStream } from "node:fs";
import { sessionsRepo, messagesRepo } from "./db.js";

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(process.cwd(), ".codex-home");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");

type CodexEventLine = {
  timestamp?: string;
  type: string;
  payload?: Record<string, unknown>;
};

type SessionMetaPayload = {
  id: string;
  timestamp: string;
  cwd?: string;
  model_provider?: string;
  [k: string]: unknown;
};

function mapEventToRole(type: string): string | null {
  if (type === "user_message") return "user";
  if (type === "agent_message") return "assistant";
  if (type === "exec_command_end" || type === "exec_command") return "tool";
  return null;
}

function buildParts(type: string, payload: Record<string, unknown>): unknown[] {
  if (type === "user_message") {
    return [{ type: "text", text: String(payload.message ?? "") }];
  }
  if (type === "agent_message") {
    return [{ type: "text", text: String(payload.message ?? "") }];
  }
  if (type === "exec_command_end") {
    const cmd = Array.isArray(payload.command)
      ? (payload.command as string[]).join(" ")
      : String(payload.command ?? "");
    return [
      {
        type: "tool-call",
        toolName: "shell",
        args: { command: cmd },
        result: String(payload.aggregated_output ?? payload.stdout ?? ""),
        isError: Number(payload.exit_code ?? 0) !== 0,
      },
    ];
  }
  if (type === "exec_command") {
    const cmd = Array.isArray(payload.command)
      ? (payload.command as string[]).join(" ")
      : String(payload.command ?? "");
    return [{ type: "tool-call", toolName: "shell", args: { command: cmd } }];
  }
  return [{ type: "text", text: JSON.stringify(payload) }];
}

async function scanJsonlFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return found;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      found.push(...(await scanJsonlFiles(full)));
    } else if (stat.isFile() && name.endsWith(".jsonl")) {
      found.push(full);
    }
  }
  return found;
}

async function importFile(filePath: string): Promise<number> {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let sessionId: string | null = null;
  let firstUserMessage: string | null = null;
  let modelProvider: string | null = null;
  let sessionTimestamp: number = Date.now();
  let messageCount = 0;

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;

    let evt: CodexEventLine;
    try {
      evt = JSON.parse(line) as CodexEventLine;
    } catch {
      console.warn(`[persistence] JSONL parse error in ${path.basename(filePath)}: ${line.slice(0, 80)}`);
      continue;
    }

    const type = String(evt.type ?? "");
    const payload = (evt.payload ?? {}) as Record<string, unknown>;
    const ts = evt.timestamp ? new Date(evt.timestamp).getTime() : Date.now();

    if (type === "session_meta") {
      const meta = payload as unknown as SessionMetaPayload;
      sessionId = String(meta.id ?? "").trim();
      if (!sessionId) {
        console.warn(`[persistence] session_meta missing id in ${path.basename(filePath)}, skipping`);
        break;
      }

      if (sessionsRepo.getById(sessionId)) {
        return 0;
      }

      modelProvider = String(meta.model_provider ?? "openai");
      sessionTimestamp = meta.timestamp ? new Date(meta.timestamp).getTime() : Date.now();
      continue;
    }

    if (!sessionId) continue;

    if (type === "user_message" && firstUserMessage === null) {
      firstUserMessage = String(payload.message ?? "").slice(0, 60);
    }

    const role = mapEventToRole(type);

    // Lazy-create session on first message that we want to persist
    if (role !== null && messageCount === 0) {
      const title = firstUserMessage
        ? `Imported — ${firstUserMessage}`
        : `Imported — ${path.basename(filePath)}`;

      try {
        const db = (await import("./db.js")).openDb();
        const now = Date.now();
        db.prepare(
          `INSERT OR IGNORE INTO sessions
           (id, workspace_id, cli, title, model, approval_mode, created_at, updated_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          sessionId,
          "imported-codex",
          "codex",
          title,
          modelProvider ?? "openai",
          "confirm",
          sessionTimestamp,
          now,
          "closed"
        );
      } catch (e) {
        console.warn(`[persistence] failed to create session ${sessionId}:`, e);
        break;
      }
    }

    if (role === null) continue;

    try {
      messagesRepo.append({
        sessionId,
        role,
        parts: buildParts(type, payload),
      });
      messageCount++;
    } catch (e) {
      console.warn(`[persistence] failed to append message for ${sessionId}:`, e);
    }
  }

  return messageCount;
}

export async function importCodexRollouts(): Promise<void> {
  let files: string[];
  try {
    await fs.access(SESSIONS_DIR);
    files = await scanJsonlFiles(SESSIONS_DIR);
  } catch {
    return;
  }

  if (files.length === 0) return;

  let totalRollouts = 0;
  let totalMessages = 0;

  for (const filePath of files) {
    try {
      const msgs = await importFile(filePath);
      if (msgs > 0) {
        totalRollouts++;
        totalMessages += msgs;
      }
    } catch (e) {
      console.warn(`[persistence] error importing ${path.basename(filePath)}:`, e);
    }
  }

  if (totalRollouts > 0) {
    console.log(
      `[persistence] imported ${totalRollouts} rollouts (${totalMessages} messages) from .codex-home/sessions/`
    );
  }
}
