# ide-ux-agentik

GPU-accelerated IDE for AI coding agents — manage git worktrees and run Codex / Claude Code / OpenCode / Gemini in per-workspace chat or terminal sessions.

> **Architecture in one line** : un agent Node tourne localement, le front Vite/React le pilote en WebSocket. L'agent **spawn les binaires CLI** (`codex`, `claude`, …) et streame leurs events JSON dans l'UI. **Pas d'appel API direct** vers Anthropic/OpenAI — toute l'intelligence vient du CLI installé localement.

## Prérequis

| Outil                     | Version   | Pourquoi                                                                                                                                 |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Bun**                   | ≥ 1.2     | Front Vite, scripts dev. `curl -fsSL https://bun.sh/install \| bash`                                                                     |
| **Node**                  | ≥ 24      | Agent server (`--experimental-strip-types` pour lire `.ts` natif). Bun ne marche pas pour l'agent à cause d'un bug `node-pty` + `codex`. |
| **codex CLI**             | latest    | Pour la chat tab côté Codex. `npm i -g @openai/codex` puis `codex login`.                                                                |
| **claude CLI**            | latest    | Pour la chat tab côté Claude Code. Voir section ci-dessous.                                                                              |
| **opencode** / **gemini** | optionnel | Si tu veux ces tabs aussi.                                                                                                               |

Aucun de ces binaires n'est obligatoire pour démarrer le front — mais une chat tab dont le binaire est manquant retournera juste « no remote-agent workspace » jusqu'à ce que tu l'installes et l'authentifies.

## Installer Claude Code CLI

```bash
# Via npm (officiel)
npm i -g @anthropic-ai/claude-code

# Authentification — deux options :
# (a) OAuth interactif (recommandé pour les abonnés Claude.ai Pro/Max)
claude login
#   → ouvre une page d'auth, stocke les tokens dans ~/.claude/.credentials.json

# (b) API key directe
export ANTHROPIC_API_KEY=sk-ant-...
#   → utilisable côte-à-côte avec OAuth, l'API key prend priorité quand elle est posée
```

Vérifier : `claude --version` puis `claude -p "say hi"`.

L'app lit `~/.claude/.credentials.json` indirectement via le binaire — tu n'as pas à passer la clé dans l'UI sauf si tu veux forcer une autre clé pour cette workspace (Settings → Providers → Claude → API key).

## Installer Codex CLI

```bash
npm i -g @openai/codex
codex login   # OAuth ChatGPT (Plus / Pro / Team / Enterprise)
# OU
export OPENAI_API_KEY=sk-...
```

Vérifier : `codex exec "say hi"`.

L'OAuth Codex est aussi gérable depuis l'app (Settings → Providers → Codex → Sign in).

## Démarrer en local

```bash
bun install
bun run dev
# → front sur http://localhost:8080
# → agent sur ws://localhost:8090 (auto-spawn par scripts/dev.ts)
```

Au premier lancement, un workspace dev-agent est auto-enregistré (la racine du projet). Si tu veux pointer sur un autre dossier, ajoute un workspace remote-agent depuis l'UI.

## Tests

```bash
bun run test:e2e           # smoke offline (sans agent)
bun run test:e2e:agent     # intégration avec un agent Node spawné par le spec
bun run test:e2e:ui        # UI Playwright interactive
```

## Commandes utiles dans la chat tab

| Slash             | Effet                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/clear`          | Vide le thread + supprime les messages persistés en SQLite.                                                      |
| `/compact`        | Résume la conversation via `codex exec --json` (Codex) puis remplace l'historique par le résumé. ~120 s timeout. |
| `/help`           | Liste les commandes disponibles.                                                                                 |
| `/reset` / `/new` | Aliases de `/clear`.                                                                                             |

## Layout

- `agent/` — server Node (RPC over WebSocket, spawn CLI, persistence SQLite). Contrat documenté dans `agent/server.ts`.
- `src/` — front Vite + assistant-ui. Conventions : voir `AGENTS.md` (workflow) et `CLAUDE.md` (gotchas).
- `e2e/` — Playwright specs.
- `scripts/dev.ts` — orchestrateur dev (spawn front + agent en parallèle, sous Node + Bun selon le composant).
- `~/.ide-ux-agentik/data.sqlite` — base persistée (sessions, messages, snapshots, blobs content-addressed).

## Pourquoi pas d'API directe Anthropic/OpenAI ?

Choix conscient : tout le tool-harness (shell, read/write/edit, glob, grep, todowrite, plan, skills, subagents, MCP, …) vit dans les binaires `codex` et `claude`. Réimplémenter côté agent demanderait des mois de travail et un suivi permanent des évolutions des CLI. En spawnant le binaire on récupère ces capacités gratuitement — au prix d'une dépendance d'install. Cf. décision stockée dans engram, et le repo de référence [MakFly/claude-code](https://github.com/MakFly/claude-code) qui montre l'ampleur du tool-harness.
