# workflow-rev — outil sibling de reverse-engineering workflow

> Repo : `/Users/kev/Documents/lab/sandbox/workflow-rev/` (sibling, indépendant)

## But

Capturer des fenêtres d'apps agent/IDE tierces (Cursor, Superconductor,
Continue, …) puis demander à Claude Code ou Codex d'extraire les patterns
de workflow visibles. Sortie : un rapport Markdown structuré qu'on peut
versionner ici sous `docs/research/workflow-<app>-<date>.md`.

## Pourquoi sibling et pas sous-dossier

- Stack distincte (Go vs TS) → pas de pollution du repo principal
- Réutilisable pour d'autres projets
- Le cycle de vie de l'outil (rare évolutions) est dissocié de l'IDE

## Quand l'utiliser

À chaque fois qu'on veut :
- Comparer notre arborescence de workflow à un concurrent visible
- Documenter "ce qu'on n'a pas encore" avant un refactor (cf. commit 3)
- Garder une trace versionnée des conventions UX adoptées par d'autres

## Cibles immédiates (à générer manuellement)

| Cible | Status | Rapport attendu |
|---|---|---|
| Cursor agent window | TODO | `docs/research/workflow-cursor-agent-2026-04-26.md` |
| Superconductor (vue tâches) | TODO | `docs/research/workflow-superconductor-2026-04-26.md` |
| Synthèse comparative | TODO | `docs/research/workflow-synthese-2026-04-26.md` |

> Les captures requièrent l'accès **Enregistrement d'écran** macOS pour le
> terminal qui lance `workflow-rev` (Réglages → Confidentialité → Enregistrement d'écran).

## Procédure

```sh
cd /Users/kev/Documents/lab/sandbox/workflow-rev
go build -o ./bin/workflow-rev ./cmd/workflow-rev

# Cursor (avoir Cursor ouvert sur la fenêtre agent)
./bin/workflow-rev capture cursor --window-title 'Agent' --output ./out
./bin/workflow-rev analyze ./out --backend claude --output ./reports

# Copier le rapport produit dans ide-ux-agentik :
cp ./reports/cursor-*.md \
   ../ide-ux-agentik/docs/research/workflow-cursor-agent-2026-04-26.md
```

## Sécurité — rappel

L'outil envoie des **screenshots** à un LLM hébergé. Avant chaque capture :
1. Cadrer la fenêtre cible (pas tout l'écran)
2. Vider toute zone contenant tokens, mots de passe, code privé sensible
3. Fermer les notifications systèmes (Slack, mail) qui pourraient apparaître
