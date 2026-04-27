# Workflow — Superconductor (2026-04-26)

- **Generated**: 2026-04-26
- **Scope**: fenêtre `superconductor` (capture directe)

## 1. Concepts visibles

- La fenêtre est centrée sur les sessions Git/branches : `errorwatch` en haut, `main` comme item actif.
- L’agent est explicitement référencé (`Claude Code v2.1.119`).
- Modèle + contexte visibles en permanence (`Opus 4.6 (1M context)`, `Ctx: 0.0%`).
- Panneau droit orienté état Git (`Uncommitted (25)`, `+835 -116`, `Changes 25`) avec statuts `A/M/D`.
- En dessous : sous-onglets d’exécution (`Setup`, `Run`, `Terminal`).

## 2. Architecture

- **Gauche** : liste des sessions/branches par projet avec `+` de création.
- **Centre** : conversation + terminal de l’agent (incluant statut/permissions).
- **Droite** : inspection continue des changements + actions de run (`Configure run script`, etc.).

## 3. États observables

- Session active mise en surbrillance.
- Diff non commité visible en permanence (`Uncommitted` + compteur + badges par fichier).
- Branche courante affichée (`main`).
- Message d’avertissement système `bypass permissions`/`shift+tab`.
- Aucune commande run script configurée (`No run script configured`).

## 4. Actions exposées

- `+` pour créer/sélectionner une nouvelle branche ou session.
- `Commit and push` directement dans la zone droite.
- Onglets d’exploration (`Files`, `Changes`, `Checks`) et de runtime (`Setup`, `Run`, `Terminal`).
- Actions sur fichiers modifiés dans `Changes` (accès direct par clic).

## 5. Gaps vs IDE classique

- Pas d’éditeur de code central visible.
- Pas d’arborescence projet complète au centre (focus agent + git-exec).
- Pas de terminal classique séparé de la vue agent.

## 6. Patterns réutilisables

1. **Session = branche = worktree** : coupler session, branch et workspace dans un même objet de navigation.
2. **Header de contexte actif** (model/ctx/branch/diff) affiché en permanence.
3. **Diff dock permanent** en colonne droite pour éviter la perte de contexte lors d’un run.
4. **CTA de fin de cycle près du flux Git** (`Commit and push`), pas caché.
5. **Slots Setup/Run/Terminal** distincts pour structurer la boucle de travail.
