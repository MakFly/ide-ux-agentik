/**
 * Wipe legacy localStorage keys from the era when org/user/workspaces lived
 * on the client. Single source of truth is now the agent SQLite (see
 * server-adapter.ts). Runs once at boot, silently.
 */

const LEGACY_PREFIXES = ["ide.org.", "ide.user.", "ide.ws."];

export function dropLegacyClientStore(): { removed: number } {
  if (typeof window === "undefined") return { removed: 0 };
  const toRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k) continue;
    if (LEGACY_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
  }
  for (const k of toRemove) window.localStorage.removeItem(k);
  if (toRemove.length > 0) {
    console.info(`[storage] dropped ${toRemove.length} legacy client-side keys`);
  }
  return { removed: toRemove.length };
}
