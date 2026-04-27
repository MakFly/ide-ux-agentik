# Changelog

Toutes les modifications notables sont consignées ici. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/), versionning
[SemVer](https://semver.org/).

## [0.1.0-alpha.1] — 2026-04-27

Première release publique. Périmètre : flow Agent-first releasable, sans risque
de perte de données utilisateur.

### Added
- `Workspace.rootPathOwnership` : marqueur explicite (`"user-selected" |
  "app-created"`) qui trace la provenance du dossier racine d'un workspace.
  Migration SQLite idempotente (`ALTER TABLE workspaces ADD COLUMN
  root_path_ownership TEXT`). Les workspaces existants sont rétro-marqués
  `NULL` et traités comme `"user-selected"` côté agent (défaut sûr).
- Tab **Choose folder from file system…** marque le workspace `user-selected`.
- Tab **Clone repo (GitHub)** marque le workspace `app-created` après un clone
  réussi.
- Workflow refonte : task-tree, diff-stat, kind sessions,
  files/changes/checks RPCs, session-resume, task-attachments, organization
  settings, command palette, plan toggle, refonte UI agent-session /
  conversation / files panel.
- Tests chat (`session-resume`, `task-attachments`, `context-windows`).
- Notes de recherche workflow (`docs/research/workflow-{cursor-agent,
  superconductor, synthese, rev-tool}-2026-04-26.md`).

### Changed
- **`workspaces.delete`** ne supprime plus inconditionnellement le dossier
  disque. La suppression physique n'a lieu que pour les workspaces
  `app-created` (clones GitHub). Les dossiers `user-selected` et legacy
  (NULL) restent intacts. La validation `resolveWorkspaceDeletePath` (`$HOME`
  / `AGENT_ROOT`) reste comme défense en profondeur.
- `.gitignore` revu : `.agents/`, `.ignore`, `.playwright-mcp/`, images
  ad-hoc (`*.png|jpg|jpeg|gif|webp`) désormais exclus.

### Security
- Plus aucun chemin de code ne peut effacer un dossier utilisateur lors de la
  suppression d'un workspace.

### Validations
- `bun run build:dev` : ✅
- `bunx eslint` sur fichiers touchés : ✅
- `bunx tsc --noEmit` : 0 erreur sur les fichiers de la feature. 27 erreurs
  hors-scope préexistantes dans `e2e/*.spec.ts` et `Workspace.tsx` (tracking
  séparé, post-alpha).

### Risques connus / non-objectifs
- Pas d'UI pour reclasser un workspace après création.
- Worktrees de tasks (`git worktree add` dans un workspace existant) hors
  scope — leur cleanup suit son propre chemin.
- Validation e2e manuelle du golden path (Choose folder → delete → SENTINEL
  intact) à exécuter par l'utilisateur avant promotion `alpha → beta`.
