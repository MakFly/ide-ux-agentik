# UI References

Captures visuelles des IDE qu'on cherche à reproduire pour le P1. À garder en tête à chaque itération UX/UI.

## Cursor 3 — Agents Window

- `cursor-3-agents-window.png` — layout en tuiles (4 agents en parallèle, tabs par repo/worktree, composer bottom-docked, badge d'état par agent).
  Source : https://cursor.com/changelog/3-0
- `cursor-3-filters-search.png` — vue search/filters (picker de fichiers, scoping par repo).
  Source : https://cursor.com/changelog

**Patterns clés à reprendre** :
- Tabs par agent/worktree + split en grille (tiled layout).
- Composer ancré en bas de chaque panneau, pas en sidebar.
- Badge d'état (running / waiting / done) sur le tab.
- Header minimal, pas de barre de menus — titre du thread + actions Git à droite.

## Codex App (OpenAI)

- `codex-app-mac-dark.webp` — macOS dark, layout 3 colonnes : sidebar threads/projects, chat central, diff view à droite.
  Source : https://developers.openai.com/codex/app
- `codex-app-mac-light.webp` — même layout, light theme.
- `codex-app-windows-dark.webp` — variante Windows.

**Patterns clés à reprendre** :
- Sidebar gauche : projets → threads (worktrees) groupés.
- Split chat / diff review côte à côte (pas d'onglets pour naviguer).
- Composer avec model selector + permissions + "Work locally" footer.
- Terminal intégré toggleable (Cmd+J équivalent).
- Git actions (Commit, Review) en haut à droite, toujours visibles.

## Synthèse pour P1

Convergence des deux produits :
1. **Multi-agent first** — liste de threads/worktrees en sidebar, pas de fichier-tree-centric.
2. **Diff inline, review natif** — pas besoin d'ouvrir un PR GitHub pour valider.
3. **Composer bas + actions Git haut** — jamais de menus cachés.
4. **Terminal comme détail, pas comme home** — toggleable dans le thread.
5. **Tiled / tabs pour paralléliser** — voir plusieurs agents sans switch.
