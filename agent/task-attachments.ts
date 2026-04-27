import fs from "node:fs/promises";
import path from "node:path";

export type AgentTaskAttachment = {
  name?: unknown;
  contentType?: unknown;
  kind?: unknown;
  data?: unknown;
};

export type MaterializedTaskAttachment = {
  name: string;
  contentType: string;
  kind: string;
  path: string;
  bytes: number;
};

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 75 * 1024 * 1024;
const MANIFEST_FILE = "manifest.json";

function attachmentsDir(root: string, taskId: string): string {
  return path.join(root, ".multica", "attachments", taskId);
}

function runtimeAttachmentsDir(worktreePath: string, taskId: string): string {
  return path.join(worktreePath, ".multica", "runtime-attachments", taskId);
}

function safeAttachmentName(name: string, index: number): string {
  const fallback = `attachment-${index + 1}`;
  const base = path.basename(name || fallback).replace(/[^A-Za-z0-9._-]/g, "_");
  const trimmed = base.replace(/^_+/, "").slice(0, 120);
  return trimmed || fallback;
}

function normalizeAttachment(raw: AgentTaskAttachment, index: number) {
  const name = safeAttachmentName(String(raw.name ?? ""), index);
  const contentType = String(raw.contentType ?? "application/octet-stream").trim();
  const kind = String(raw.kind ?? "file").trim() || "file";
  const data = typeof raw.data === "string" ? raw.data : "";
  if (!data) return null;
  return { name, contentType: contentType || "application/octet-stream", kind, data };
}

async function writeManifest(dir: string, items: MaterializedTaskAttachment[]): Promise<void> {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  await fs.writeFile(manifestPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function readManifest(dir: string): Promise<MaterializedTaskAttachment[]> {
  try {
    const raw = await fs.readFile(path.join(dir, MANIFEST_FILE), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MaterializedTaskAttachment => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return (
        typeof value.name === "string" &&
        typeof value.contentType === "string" &&
        typeof value.kind === "string" &&
        typeof value.path === "string" &&
        typeof value.bytes === "number"
      );
    });
  } catch {
    return [];
  }
}

export async function readTaskAttachments(
  root: string,
  taskId: string,
): Promise<MaterializedTaskAttachment[]> {
  return readManifest(attachmentsDir(root, taskId));
}

export async function materializeTaskAttachments(
  root: string,
  taskId: string,
  attachments: unknown,
): Promise<MaterializedTaskAttachment[]> {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const dir = attachmentsDir(root, taskId);
  await fs.mkdir(dir, { recursive: true });
  const existing = await readManifest(dir);
  const created: MaterializedTaskAttachment[] = [];
  let totalBytes = existing.reduce((sum, item) => sum + item.bytes, 0);
  const batchTimestamp = Date.now();

  for (let index = 0; index < attachments.length; index += 1) {
    const normalized = normalizeAttachment(attachments[index] as AgentTaskAttachment, index);
    if (!normalized) continue;

    const buffer = Buffer.from(normalized.data, "base64");
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`attachment too large: ${normalized.name}`);
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("attachments exceed total size limit");
    }

    const filename = `${batchTimestamp}-${index + 1}-${normalized.name}`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, buffer);
    created.push({
      name: normalized.name,
      contentType: normalized.contentType,
      kind: normalized.kind,
      path: filePath,
      bytes: buffer.byteLength,
    });
  }

  if (created.length > 0) await writeManifest(dir, [...existing, ...created]);
  return created;
}

function attachmentBatchTimestamp(attachment: MaterializedTaskAttachment): number {
  const basename = path.basename(attachment.path);
  const match = /^(\d+)-\d+-/.exec(basename);
  if (!match) return 0;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function latestTaskAttachmentBatch(
  attachments: MaterializedTaskAttachment[],
): MaterializedTaskAttachment[] {
  let latestTimestamp = 0;
  for (const attachment of attachments) {
    latestTimestamp = Math.max(latestTimestamp, attachmentBatchTimestamp(attachment));
  }
  if (latestTimestamp === 0) return attachments;
  return attachments.filter(
    (attachment) => attachmentBatchTimestamp(attachment) === latestTimestamp,
  );
}

export async function stageTaskAttachmentsForWorktree(
  worktreePath: string,
  taskId: string,
  attachments: MaterializedTaskAttachment[],
): Promise<MaterializedTaskAttachment[]> {
  if (attachments.length === 0) return [];

  const dir = runtimeAttachmentsDir(worktreePath, taskId);
  await fs.mkdir(dir, { recursive: true });

  const staged: MaterializedTaskAttachment[] = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index]!;
    const filename = `${index + 1}-${safeAttachmentName(attachment.name, index)}`;
    const filePath = path.join(dir, filename);
    await fs.copyFile(attachment.path, filePath);
    staged.push({ ...attachment, path: filePath });
  }

  return staged;
}

export function appendTaskAttachmentsToPrompt(
  prompt: string,
  attachments: MaterializedTaskAttachment[],
): string {
  if (attachments.length === 0) return prompt;

  const lines = attachments.map((attachment, index) => {
    return `${index + 1}. ${attachment.kind} "${attachment.name}" (${attachment.contentType}, ${attachment.bytes} bytes): ${attachment.path}`;
  });

  return [
    prompt,
    "## Attachments",
    "The user attached the following local files. Inspect the file paths directly when answering about images, documents, or file contents.",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}
