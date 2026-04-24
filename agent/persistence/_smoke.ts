/**
 * Smoke test: roundtrip create session → append 200 messages →
 * paginate → add snapshot → read blob.
 *
 * Run: ./node_modules/.bin/tsx agent/persistence/_smoke.ts
 */
import { openDb, closeDb, sessionsRepo, messagesRepo, snapshotsRepo, writeQueue } from "./db.js";

openDb();

// 1. Session
const session = sessionsRepo.create({ workspaceId: "smoke-ws", cli: "codex" });
console.log(`session: ${session.id}`);

// 2. Append 200 messages via queue
const START = Date.now();
for (let i = 0; i < 200; i++) {
  messagesRepo.append({
    sessionId: session.id,
    role: i % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `message ${i}` }],
    cwd: "/tmp",
    gitBranch: "main",
    slug: `slug-${i}`,
    version: "1.0.0",
  });
}
writeQueue.flush();
const elapsed = Date.now() - START;
console.log(`200 messages inserted in ${elapsed}ms`);

// 3. Pagination: first page
const page1 = messagesRepo.list({ sessionId: session.id, limit: 10 });
console.log(`page1 (latest 10): ids [${page1[0]?.ts}..${page1[page1.length - 1]?.ts}], count=${page1.length}`);

// 4. Cursor page: beforeTs of oldest in page1
const oldestTs = page1[0]!.ts;
const page2 = messagesRepo.list({ sessionId: session.id, limit: 10, beforeTs: oldestTs });
console.log(`page2 (before ${oldestTs}): count=${page2.length}`);

// 5. Snapshot + blob roundtrip
const snap = snapshotsRepo.add({
  sessionId: session.id,
  path: "src/foo.ts",
  contentBefore: "const x = 1;",
  contentAfter: "const x = 2;",
});
console.log(`snapshot: before_hash=${snap.content_before_hash}, after_hash=${snap.content_after_hash}`);

const blob = snapshotsRepo.readBlob(snap.content_after_hash!);
const content = blob?.toString("utf8");
console.assert(content === "const x = 2;", `blob content mismatch: ${content}`);
console.log(`blob read OK: "${content}"`);

// 6. Total count sanity
const all = messagesRepo.listBySession(session.id);
console.assert(all.length === 200, `expected 200 messages, got ${all.length}`);
console.log(`total messages: ${all.length} ✓`);

// 7. Cleanup (leave DB for inspection)
closeDb();
console.log("smoke OK");
