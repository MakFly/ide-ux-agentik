# Synthèse comparative — Cursor vs Superconductor (2026-04-26)

Objectif : rapprocher l’agent-window de `ide-ux-agentik` du comportement de ces deux références.

## Convergences observées

1. **Unités de travail = sessions, pas fichiers**
   - Cursor et Superconductor traitent une session comme point d’entrée.
   - Superconductor lie aussi session/branche/worktree.

2. **Centre = conversation, panneaux latéraux = état machine**
   - Colonnes gauche/droite servent à la navigation et au contexte d’exécution.

3. **Contexte agent visible dans l’UI**
   - Modèle, contexte, permissions et statut apparaissent directement.

4. **Prompt ancré en bas**
   - Composer toujours accessible au fond de la fenêtre.

## Différences utiles à intégrer

- Cursor met l’accent sur la persistance des threads par projet.
- Superconductor expose davantage `diff/changes` et actions Git dans un panneau secondaire.
- Notre base actuelle est plus proche du modèle `task-first` ; il faut renforcer la navigation visuelle “session/thread”.

## Plan court pour aligner l’UX

1. **Renforcer la navigation de session**
   - Grouping explicite `workspace → sessions`, avec badge actif clair.
   - Distinguer `sessions` vs `tasks` pour éviter ambiguïté.

2. **Header de contexte session actif**
   - Afficher `model`, `runtime`, `ctx`, `branch`, `diff stat` (si dispo)
     en haut de la vue conversation.

3. **Panneau droit “Run + Git” stable**
   - Conserver les changements visibles (ou au moins un résumé count) pendant le run.
   - Prévoir `Changes` + `Run`/`Terminal` sans quitter la session.

4. **Composer UX**
   - Ajouter un flux clair `new-session`, `model`, `mode execution` avec labels lisibles.

5. **Close loop Git**
   - Intégrer un CTA `Commit`/`Commit and push` proche du statut de run (si applicable).

## Actions immédiates recommandées

1. Mettre à jour les docs de sprint avec cette synthèse comme baseline.
2. Vérifier dans `src/components/ide` que la hiérarchie `sidebar → centre → right panel`
   reflète bien `session → workspace → files`.
3. Ajouter des tests visuels E2E (smoke) sur les zones `session`, `model`, `changes`, `composer`.
