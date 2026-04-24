# SPRINT P3 — webapp RAF

> État des lieux post-P1/P2 et liste ciblée du travail qui reste pour
> atteindre parité fonctionnelle avec Cursor 3 Agents Window + Codex App.
> Tauri est hors scope de ce sprint (arrive en P4).

## Done

- **P1** (8 commits) — sidebar sessions, tabs badges, tiled multi-agent
  (pin/unpin, max 4 panels), git actions top-right, DiffView inline,
  universal model pill, approval pill, kill-session AlertDialog.
- **P2** (4 commits) — SQLite end-to-end (`~/.ide-ux-agentik/data.sqlite`,
  WAL + FK + write queue 100 ms + blobs content-addressed), Zustand
  `persist()` whitelist UI-only, codex-adapter écrit user + assistant
  à chaque tour, `useSessionHistory` lit les 50 derniers avant mount du
  runtime, import idempotent des rollouts `.codex-home/sessions/*.jsonl`.
- **Fix suite** — token auth refresh (dev-bootstrap), TDZ
  onRehydrateStorage, FK id forwarding, `sessions.delete` cascade sur
  kill, mount runtime après loading. Tous documentés dans `CLAUDE.md`.

## RAF — par valeur / risque

### A — Bloquants fonctionnels (à faire en priorité)

1. **Adapters `claude` / `opencode` / `gemini`** — aujourd'hui seul
   `codex-adapter` écrit en DB. Les 3 autres CLIs affichent la bannière
   "experimental" et ne persistent rien. Dupliquer le pattern
   `codex-adapter.ts` → `claude-adapter.ts`, etc. RPC `chat.spawn` gère
   déjà les 4 binaires, c'est surtout un parser NDJSON par CLI.
   _Fichiers : `src/lib/chat/_-adapter.ts`, `chat-view.tsx` pour dispatch.\*

2. **Session-create au click "nouvelle session"** — aujourd'hui la ligne
   DB n'existe qu'après le **premier message**. Si l'utilisateur crée
   une session, ferme l'onglet sans parler, le tab disparaît
   silencieusement au refresh. Fix : wrapper `addAgentSession(...)` doit
   appeler `persistence.sessions.create(id=terminalId, ...)`.
   _Fichier : `src/store/ide.ts` → `addAgentSession` ou équivalent._

3. **Approval-pill wire-through RPC** — toujours en dry-run (TODO ligne 37
   de `approval-pill.tsx`). La valeur choisie doit passer dans
   `chat.spawn` `extraArgs` — `--ask-for-approval` / `--sandbox` pour
   Codex, équivalents pour Claude. Ajouter flag allowlist côté
   `agent/server.ts ALLOWED_CHAT_FLAGS`.

### B — Parité UX Cursor / Codex

4. **Worktree UI par agent** — le store a `worktreesByBranch` mais la
   sidebar n'expose pas le lien agent ↔ worktree. Cursor 3 attache
   chaque agent à un worktree isolé. Ajouter une section "Worktrees"
   dans la Sidebar avec rattachement de session.
   _Fichiers : `Sidebar.tsx`, potentielle action `attachSessionToWorktree`._

5. **File-change inline dans le thread** — quand l'agent modifie un
   fichier, pas de DiffView rendu dans le message assistant (seulement
   via le bouton Diff top-right). Pattern Codex : badge "N files
   changed" cliquable → expanded DiffView. Utilise les
   `file_snapshots` déjà stockés en DB.
   _Fichiers : nouveau `assistant-ui/message-file-changes.tsx`._

6. **Tool-call parts en rehydration** — `useSessionHistory` skip les
   parts `tool-call` (orphelins crasheraient assistant-ui). Fix : paire
   chaque `tool-call` avec son `tool-result` dans le même message en
   regroupant les lignes DB `role=tool` dans le message assistant
   précédent.

7. **Pagination UI "Load older"** — cap 50 messages dans la Thread. Au
   scroll-top ou via bouton, charger les 50 précédents via
   `messages.list({sessionId, limit: 50, beforeTs})`. Indicateur visuel
   "N older messages available" quand la liste DB dépasse 50.

### C — Robustesse

8. **Feedback utilisateur sur pin 5e** — `pinSession` refuse
   silencieusement quand `pinnedIds.length >= 3`. Ajouter toast
   "Maximum 4 agents side-by-side".

9. **Supervision processus** — si `codex` crash, le store garde la
   session en `status: "busy"` infini. Watcher côté `agent/server.ts`
   doit émettre un event `session.status` au SIGCHLD et le client met
   à jour.

10. **GC des blobs orphelins** — `file_blobs` accumulate sans recyclage.
    Job sqlite : `DELETE FROM file_blobs WHERE id NOT IN (SELECT
content_before_hash FROM file_snapshots UNION SELECT
content_after_hash FROM file_snapshots)` + `rm` les fichiers disque.
    Déclenchement : au boot agent ou via un bouton Settings.

11. **Cleanup model selector hardcodé** — `model-pill.tsx` porte 4
    catalogues en dur. Ajouter RPC `models.list(cli)` qui lit depuis
    `.codex-home/models_cache.json` (Codex) ou une config équivalente
    par CLI, avec fallback sur la liste en dur.

### D — QA / dette

12. **4 erreurs TypeScript pré-existantes** — `nav-user.tsx:96`
    (variant prop) et `pagination.tsx` (ButtonProps export + double
    size). 5 min à fix, traîne depuis le début de cette branche.

13. **e2e sur composants P1/P2** — zéro test Playwright sur
    sessions-section, tiled layout, kill dialog, git actions, diff
    view. Risque de régression élevé.

14. **Performance chat TTFT** — `codex exec --json` spawné à chaque
    turn (cold start 1-3 s) + transcript renvoyé à chaque tour (`O(N²)`
    tokens). Migrer vers Codex App Server natif (sessions persistantes
    côté CLI) — c'est la "v2" mentionnée dans `CLAUDE.md` ligne 70.

## Reco d'exécution

- **Wave P3.1 (bloquants)** : items 1 + 2 + 3 → parité fonctionnelle
  multi-CLI. ~2 sub-agents en parallèle sur 1-2 (adapters + session DB
  create), 1 sub-agent sur 3 (approval RPC).
- **Wave P3.2 (UX)** : items 4 + 5 + 6 + 7 — fidélité au pattern Codex.
  Parallelisables.
- **Wave P3.3 (robustesse + dette)** : 8–14, petits commits isolés.

P4 ensuite : Tauri bundle + sync cloud (team memory à la Claude Code)

- migration Codex App Server.
