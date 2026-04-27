# Postmortem backlog — 2026-04-26

Findings de l'audit `/team-review` non traités dans le commit 1 (`feat/workflow-refonte-2026-04`).
Le commit 1 a fermé : 6 CRITICAL + 7 HIGH (3 RCE/env, races, fuites de ressources, déconnexions sales, erreurs compile).

## Dette technique exposée par `tsconfig.agent.json`

L'introduction de `tsconfig.agent.json` met en lumière **24 erreurs `tsc` préexistantes** dans `agent/`. Aucune n'est introduite par le commit 1 ; toutes existaient déjà mais étaient cachées car `agent/` n'était pas inclus dans le `tsconfig.json` principal.

### Catégories

| Type | Nombre | Exemple | Niveau |
|---|---|---|---|
| Module `node:http` non résolu | 1 | `agent/server.ts:25` | config — investiguer |
| `Buffer` utilisé comme valeur (manque `import { Buffer } from "node:buffer"`) | 2 | `agent/server.ts:2215`, `agent/persistence/db.ts:788` | trivial |
| `readdir(...).name`/`.isDirectory()` sur `string` (option `withFileTypes` manquante ou typing erroné) | 8 | `agent/server.ts:614,615,616,2132–2137` | bug réel — readdir retourne `string[]` mais code traite comme `Dirent[]` |
| `string \| null` non assignable à `string` (strict null checks) | 7 | `agent/server.ts:1331,1410–1411,1438–1439` | bug réel — propager null safely |
| `Expected 0 args, got 1` sur appels DAO | 4 | `agent/persistence/_smoke.ts:51`, `db.ts:1116`, `server.ts:2056,2562` | signatures DAO obsolètes |
| `req`/`res`/`raw` `any` implicite | 3 | `agent/server.ts:2498,2554` | annotations manquantes |

### Priorisation suggérée

1. **MEDIUM** — Le bug `readdir withFileTypes` (8 erreurs sur les mêmes lignes) suggère un appel `await readdir(path, { withFileTypes: true })` mais sans `as Dirent[]` ou avec mauvais override. À fixer en 1 PR ciblée.
2. **MEDIUM** — Les `string | null` proviennent probablement d'un retour DB ; ajouter des guards explicites.
3. **LOW** — Buffer/any : trivials, à grouper.

Aucune n'est exploitable runtime tant que `--experimental-strip-types` ignore les types — mais un refactor en double sans typechecker actif est dangereux. **Cible : drainer ce backlog avant le commit 3 (refactor workflow)**, sinon les nouveaux RPCs vont hériter d'une base non typée.

---

## MEDIUM/LOW de l'audit `/team-review` (non traités au commit 1)

### Sécurité MEDIUM (4)

| ID | Fichier | Pitch |
|---|---|---|
| M-S1 | `agent/server.ts:226` | `workspaces.list` retourne `source_token` en clair → exposer via RPC dédié `workspaces.getToken` |
| M-S2 | `agent/server.ts:2446` | Pas de `verifyClient` sur le WSS → ajouter check origin (localhost only sauf no-origin) |
| M-S3 | `agent/server.ts:72-73` | `SSH_AUTH_SOCK` + `GIT_SSH_COMMAND` dans `SAFE_ENV_KEYS` → retirer, injecter scope-local pour git ops |
| M-S4 | `scripts/dev.ts:71` | `process.env` complet hérité par l'agent → filtrer aux 11 vars utiles |

### Sécurité LOW (3)

| ID | Fichier | Pitch |
|---|---|---|
| L-S1 | `agent/server.ts:2573` | Token prefix dans le log de boot → retirer entièrement |
| L-S2 | `src/components/ui/chart.tsx:72-89` | `dangerouslySetInnerHTML` avec `chartId` dérivé d'`useId()` → ajouter commentaire `// SECURITY: chartId must never be user-supplied` |
| L-S3 | `src/lib/storage/endpoint.ts` | Token en `localStorage` → documenté tradeoff acceptable pour outil dev |

### Types MEDIUM (8)

ReactMarkdown props `any` (conversation-view.tsx:217-244), double-cast `as unknown as` (reasoning.tsx:248, tool-fallback.tsx:299), non-null assertions sur `Map.get` (remote-agent.ts:485,491,547,553), etc. Voir audit complet pour détail.

### Runtime MEDIUM (4)

- `agent/server.ts:2130-2136` — `exec.run` timeout `killer` non clear sur `proc.on("error")` sans `"exit"` → hang
- `src/store/ide.ts:778` — `gitDebounceHandle` singleton module-level → cancellation cross-scope
- `src/components/ide/kill-session-dialog.tsx:50-51` — `providerFor` + `provider.connect()` sans `disconnect`
- `src/store/ide.ts:1306-1376` — `hydrateSessionsFromDb` retry loop non cancellable au unmount

### Runtime LOW (3)

- `agent/server.ts:559` — `drainPendingTasks` swallow errors → tâches `pending` orphelines
- `src/lib/chat/task-launcher-adapter.ts:35-44` — erreurs rendues comme messages assistant normaux (pas de retry)
- `src/components/ide/agent-session-view.tsx:154` — `<TaskConversation key={activeSession.id}>` → unmount au switch sub-tab

---

## Plan de drainage

1. **Sprint suivant** : drainer la dette `tsconfig.agent.json` (24 erreurs) → débloque le typecheck agent en CI
2. **Sprint +1** : MEDIUM sécurité (M-S1 → M-S4) — touche surface d'attaque
3. **Sprint +1** : MEDIUM runtime hydrate/cancellation
4. **Backlog** : LOW (cosmétique + UX)
