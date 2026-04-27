# Workflow — Cursor Agent Window (2026-04-26)

- **Generated**: 2026-04-26
- **Scope**: fenêtre `Cursor Agents` (capture directe)

## 1. Concepts visibles

- La session est l’unité principale : entrée **New Agent** en haut de la colonne gauche.
- Les threads s’organisent par regroupement de projet/workspace (`kweli-mobile`, `distribution-app-v2`, `kweli`, `sandbox`).
- La zone centrale gère le dialogue d’un agent sélectionné.
- Un arbre de fichiers existe à droite, lié au workspace actif du thread.
- Les métadonnées de modèle sont visibles au footer du composer (`Composer 2 ⚡`).

## 2. Architecture

- **Colonne gauche** : navigation des sessions et projets d’agents.
- **Colonne centrale** : conversation active avec mention et historique.
- **Colonne droite** : navigateur/fichiers du workspace actif.

## 3. États observables

- Une session active est visuellement mise en évidence.
- Le runtime local est affiché (`Local`) dans la zone composer.
- Le plan utilisateur s’affiche en bas de la liste gauche (`Kevin Aubrée — Free Plan`).
- Aucun état “dirty / run / commit” de type IDE git directement visible dans cette capture.

## 4. Actions exposées

- Créer une session : `New Agent`.
- Envoyer un message / follow-up via composer.
- Changer le modèle via le sélecteur en bas.
- Ouvrir/créer des fichiers depuis le panneau droit (`Open File`, `New File`).

## 5. Gaps vs IDE classique

- Pas d’éditeur principal de code visible au centre (conversation-first).
- Pas de vue Git/SCM centralisée (pas de diff/commit intégré en continu).
- Pas de terminal dédié visible dans la même session.

## 6. Patterns réutilisables

1. **Session-first workflow** : une session = une unité de travail persistée.
2. **Moteur dans le composer** : changement de modèle directement dans la barre d’action.
3. **Mention de workspace** : contexte injecté via `@<workspace>`.
4. **Navigation par workspace+session** pour limiter les changements de contexte.
5. **Actions de files side-panel** au lieu d’un IDE “code-first”.
