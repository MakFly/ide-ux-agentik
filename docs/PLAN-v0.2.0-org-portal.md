# PLAN v0.2.0 — Org portal + nested workspace routing

## Context

v0.1.0 a un onboarding plat à `/` qui crée directement un workspace dans un store flat. v0.2.0 introduit un **niveau Org au-dessus** : `/` devient un wizard de setup (org + user + agent + premier workspace), puis l'app vit sous `/org/:id/...`. Modèle desktop-first (Tauri Mac/Linux/Windows à terme), donc les données passent par une **couche d'abstraction storage** (localStorage en browser → SQLite natif en Tauri, sans changer le code métier).

Outcome :

- Premier lancement → wizard 4 steps qui collecte org + user + agent + workspace, sauve, redirige vers `/org/:id`.
- Refresh ultérieur → si une org existe, redirect direct `/` → `/org/:id` (skip wizard, no flicker).
- Ajout / changement de workspace : se passe sous `/org/:id` (l'IDE actuel, élargi avec un breadcrumb "MyOrg / repo").
- Une seule org par utilisateur (au-dessus = futur multi-tenant si besoin).

---

## Architecture

```
                        ┌──────────────────────────────────┐
                        │  /  (route racine)               │
                        │  • check Org via storage adapter │
                        │  • si Org → redirect /org/:id    │
                        │  • sinon  → render <SetupWizard> │
                        └────────────────┬─────────────────┘
                                         │
                ┌────────────────────────┴────────────────────────┐
                │  <SetupWizard>  (Stepper plein-écran)           │
                │                                                 │
                │  Step 1 — Org                                   │
                │     ┌────────────────────────────┐              │
                │     │ name (required)            │              │
                │     │ slug (auto, editable)      │              │
                │     │ optional logo/avatar       │              │
                │     └────────────────────────────┘              │
                │  Step 2 — User                                  │
                │     ┌────────────────────────────┐              │
                │     │ display name               │              │
                │     │ email                      │              │
                │     │ default agent (codex/claude)│             │
                │     └────────────────────────────┘              │
                │  Step 3 — Agent (optional, skippable)           │
                │     ┌────────────────────────────┐              │
                │     │ Connect remote agent       │              │
                │     │ (URL + token)              │              │
                │     │ OR  Skip — local-only      │              │
                │     └────────────────────────────┘              │
                │  Step 4 — First workspace                       │
                │     ┌────────────────────────────┐              │
                │     │ <AddWorkspaceForm>         │  ← réutilise │
                │     │ (Local / Remote / GitHub)  │     existant │
                │     └────────────────────────────┘              │
                │                                                 │
                │  on Finish:                                     │
                │   1. storage.put("org", org)                    │
                │   2. storage.put("user", user)                  │
                │   3. storage.put("workspaces[orgId]", [ws])     │
                │   4. router.navigate(`/org/${org.id}`)          │
                └─────────────────────────────────────────────────┘

                        ┌──────────────────────────────────┐
                        │  /org/:id  (nested route group)  │
                        │  • loader: fetch org + workspaces│
                        │  • si 404 → redirect /           │
                        │  • render <IDE> (current shell)  │
                        └────────────────┬─────────────────┘
                                         │
                  ┌──────────────────────┴───────────────────┐
                  │  <IDE> shell (TopBar + Sidebar + …)      │
                  │  • TopBar: org name + breadcrumb         │
                  │  • Sidebar: workspaces filtrés par orgId │
                  │  • routes nested possibles plus tard:    │
                  │    /org/:id/workspace/:wsId              │
                  └──────────────────────────────────────────┘

╔══════════════════ Storage abstraction ═══════════════════╗
║                                                          ║
║   src/lib/storage/types.ts                               ║
║   ┌──────────────────────────────────────────────────┐  ║
║   │ interface StorageAdapter {                       │  ║
║   │   getOrg():       Promise<Org | null>            │  ║
║   │   putOrg(o:Org):  Promise<void>                  │  ║
║   │   getUser():      Promise<User | null>           │  ║
║   │   putUser(u:User):Promise<void>                  │  ║
║   │   getWorkspaces(orgId): Promise<Workspace[]>     │  ║
║   │   putWorkspace(orgId, ws): Promise<void>         │  ║
║   │   removeWorkspace(orgId, wsId): Promise<void>    │  ║
║   │   exportAll(): Promise<Snapshot>                 │  ║
║   │   importAll(s: Snapshot): Promise<void>          │  ║
║   │ }                                                │  ║
║   └────────────────────┬─────────────────────────────┘  ║
║                        │                                ║
║       ┌────────────────┴───────────────┐                ║
║       │                                │                ║
║   ┌───▼──────────────┐    ┌────────────▼───────────┐    ║
║   │ LocalStorageAdpt │    │ TauriSqliteAdapter     │    ║
║   │ (browser, today) │    │ (desktop, v0.3.x)      │    ║
║   │  Keys:           │    │  ~/.ide-ux-agentik/    │    ║
║   │   ide.org        │    │     data.sqlite        │    ║
║   │   ide.user       │    │  via @tauri-apps/      │    ║
║   │   ide.ws.<orgId> │    │     plugin-sql         │    ║
║   └──────────────────┘    └────────────────────────┘    ║
║                                                          ║
║   Detection: typeof window.__TAURI__ !== "undefined"     ║
║   → instancie le bon adapter au boot.                    ║
╚══════════════════════════════════════════════════════════╝

Legend
  ──▶  React Router navigate           ═══  Cross-platform abstraction
  Step → Step  Wizard linear flow      Brackets (id) URL placeholder
```

**Composants** :

- `<SetupWizard>` : stepper plein-écran (4 steps), state local + commit groupé via `storage.*` à la fin.
- `<IDE>` : le shell actuel (TopBar/Sidebar/Workspace/EditorPanel/StatusBar). Reçoit `org` + `workspaces` via route loader.
- `StorageAdapter` : interface, 2 implémentations (localStorage MVP, Tauri SQLite later).

---

## Wave 1 — Modèle de données + storage adapter

### W1.1 Types

`src/lib/types/org.ts` (NEW) :

```ts
export type Org = {
  id: string; // ulid
  name: string;
  slug: string; // url-safe
  logoUrl?: string;
  createdAt: number;
};

export type User = {
  id: string;
  displayName: string;
  email?: string;
  defaultAgent: "codex" | "claude" | "opencode" | "gemini";
};
```

`Workspace` (existing in `src/store/ide.ts:69`) → étendre avec `orgId: string`.

### W1.2 Storage abstraction

`src/lib/storage/types.ts` — interface ci-dessus.

`src/lib/storage/local-storage-adapter.ts` (NEW) — impl basée sur `window.localStorage` (clés versionnées `ide.org.v1`, etc.). Sérialisation JSON, dé-dup safe.

`src/lib/storage/index.ts` — sélecteur de runtime :

```ts
export const storage: StorageAdapter =
  typeof window !== "undefined" && (window as any).__TAURI__
    ? new TauriSqliteAdapter() // v0.3 — pour l'instant throw "not implemented"
    : new LocalStorageAdapter();
```

**Migration localStorage→adapter** : à v0.2.0 boot, lire l'ancien `ide-ux-agentik` Zustand store. Si présent + workspaces non-vides, créer une org par défaut (`name: "Personal"`, `slug: "personal"`), assigner les workspaces à cette org via `orgId`, persister via le nouvel adapter, supprimer l'ancienne clé. One-shot, idempotent. Code dans `src/lib/storage/migrate.ts`.

### W1.3 Hook React

`src/hooks/use-storage.ts` :

- `useOrg(): { org, loading }` — fetch via adapter, gate sur `_hydrated`.
- `useWorkspaces(orgId): { workspaces, loading }`.

Évite que les composants tapent l'adapter direct, facilite mocking dans les tests.

### W1.4 Refactor du store Zustand

`src/store/ide.ts` :

- Le store conserve l'IDE state runtime (active tab, scopes, panels, etc.) mais **délègue** la liste des workspaces à un sélecteur qui lit `useWorkspaces(orgId)`.
- `addWorkspace` etc. → wrappers qui (1) commit via `storage.putWorkspace()` puis (2) refresh la query.
- Retirer le `partialize.workspaces` du `persist()` — les workspaces ne sont plus dans le Zustand persist (storage adapter prend la main). Garder `persist` pour les UI prefs (theme, panel sizes, etc.).
- L'init `_hydrated` reste mais est compté dès que l'adapter a fini son premier read.

---

## Wave 2 — Wizard + routing

### W2.1 Routes

TanStack Router (déjà en place via `createFileRoute`) :

- `src/routes/index.tsx` (existant) → re-write : check `storage.getOrg()`. Si org existe → `<Navigate to={`/org/${org.id}`} />`. Sinon → `<SetupWizard />`.
- `src/routes/org/$id.tsx` (NEW) → loader `getOrg(id)` + `getWorkspaces(id)`. Render le shell IDE actuel.
- (Plus tard) `src/routes/org/$id/workspace/$wsId.tsx` pour deep-link à un workspace précis.

### W2.2 SetupWizard

`src/components/setup/setup-wizard.tsx` (NEW) :

- Stepper UI (réutiliser un composant shadcn ou écrire un simple `Step 1/4` avec progress bar).
- Step composants individuels : `step-org.tsx`, `step-user.tsx`, `step-agent.tsx`, `step-workspace.tsx`.
- State local React (formik-light : `useState` + helpers, pas besoin de lib externe).
- Validation par step (zod schemas). Disable Next tant que invalide.
- Step 3 (Agent) skippable → bouton "Skip for now". Si l'utilisateur skip ET que step 4 GitHub est sélectionné → re-prompt agent avant Finish.
- Step 4 réutilise `<AddWorkspaceForm>` existant — adapter pour ne PAS appeler `addWorkspace` du store mais retourner les valeurs au wizard parent qui commit tout en bulk.

### W2.3 Refactor `<AddWorkspaceForm>`

`src/components/ide/add-workspace-dialog.tsx` :

- Ajouter prop `onSubmit?: (input: WorkspaceInput) => void` : si présent, le form retourne juste `{ name, source, opts }` sans appeler `addWorkspace`. Si absent, comportement actuel (commit direct via store).
- Permet la réutilisation dans le wizard (commit groupé final).

### W2.4 Layout `/org/:id`

`src/routes/org/$id.tsx` :

- Loader : `await storage.getOrg(id)` → si null, `redirect("/")`.
- Loader : `await storage.getWorkspaces(id)`.
- Render le shell IDE (extrait de `routes/index.tsx` actuel) en lui passant `org` + `workspaces` via context React (`<OrgContext.Provider>`).
- TopBar augmentée : breadcrumb `<OrgName> / <WorkspaceName> / <branch>`.

### W2.5 Onboarding screen retiré

`src/components/ide/onboarding-screen.tsx` → supprimé (remplacé par le wizard).

---

## Wave 3 — Migration + polish

### W3.1 One-shot migration

À `/`, avant de check l'org, run `migrateLegacyStore()` :

- Lit `localStorage["ide-ux-agentik"]` (ancien Zustand persist).
- Si workspaces présent → crée Org "Personal", User par défaut, transfère workspaces avec `orgId`.
- Supprime l'ancienne clé.
- Toast "Migrated N workspaces to your new Personal org".

### W3.2 Edit org settings

`/org/:id/settings` : page simple pour éditer `org.name`, `org.logoUrl`, et les infos user. Pas de delete-org pour v0.2.0 (DESTRUCTIF, défer en v0.3).

### W3.3 Tests

- `bun test` : tests unitaires de `LocalStorageAdapter` (round-trip).
- Playwright : `e2e/wizard.spec.ts` (parcours complet 4 steps, finish → URL `/org/<id>`), `e2e/refresh.spec.ts` (existing org → `/` redirige direct vers `/org/:id` sans flash wizard).

---

## Critical files

| Fichier                                       | Wave | Action                                                                 |
| --------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| `src/lib/types/org.ts`                        | W1   | NEW                                                                    |
| `src/lib/storage/types.ts`                    | W1   | NEW                                                                    |
| `src/lib/storage/local-storage-adapter.ts`    | W1   | NEW                                                                    |
| `src/lib/storage/migrate.ts`                  | W3   | NEW                                                                    |
| `src/lib/storage/index.ts`                    | W1   | NEW (sélecteur runtime)                                                |
| `src/hooks/use-storage.ts`                    | W1   | NEW                                                                    |
| `src/store/ide.ts`                            | W1   | refactor : workspaces lus via adapter, retirer du `persist.partialize` |
| `src/routes/index.tsx`                        | W2   | re-write : check org, redirect ou wizard                               |
| `src/routes/org/$id.tsx`                      | W2   | NEW : loader + IDE shell                                               |
| `src/components/setup/setup-wizard.tsx`       | W2   | NEW                                                                    |
| `src/components/setup/step-org.tsx`           | W2   | NEW                                                                    |
| `src/components/setup/step-user.tsx`          | W2   | NEW                                                                    |
| `src/components/setup/step-agent.tsx`         | W2   | NEW                                                                    |
| `src/components/setup/step-workspace.tsx`     | W2   | NEW                                                                    |
| `src/components/ide/add-workspace-dialog.tsx` | W2   | ajout prop `onSubmit` pour mode "return-only"                          |
| `src/components/ide/onboarding-screen.tsx`    | W3   | DELETE                                                                 |

## Réutilisation

- `<AddWorkspaceForm>` : extrait en wave 2 v0.1.0, parfait pour step 4.
- `MOCK_ENABLED` flag : reste utilisable, l'org fictive et workspaces seedés peuvent revenir derrière le flag pour les démos.
- `providerFor()` + `gitClone` chain : le workflow GitHub du wizard utilise les mêmes RPCs.
- TanStack Router `createFileRoute` + loaders : déjà en place, on étend.
- `_hydrated` flag du store : reste utile pour gater le check d'org.

---

## Verification

### Wizard

1. `localStorage.clear() && bun run dev` → arrive sur `/` → wizard step 1, breadcrumb "Step 1/4". Remplir org name → Next. Step 2 user. Step 3 agent (Skip). Step 4 first workspace (Local folder). Finish → URL `/org/01HXXX...` → IDE rendu avec sidebar montrant le workspace créé.
2. Refresh → reste sur `/org/01HXXX...` (pas de flash wizard). Visiter `/` → redirect immédiat vers `/org/01HXXX...`.

### Migration

3. Restaurer un dump localStorage d'un store v0.1.0 (script de fixture). Reload → toast "Migrated 1 workspace…", workspaces apparaissent sous l'org "Personal" auto-générée. La clé legacy `ide-ux-agentik` est purgée.

### Multi-tenant safety

4. Modifier l'URL en `/org/wrong-id` → redirect `/`. (loader returns 404 redirect.)

### Storage abstraction

5. `bun test src/lib/storage/local-storage-adapter.test.ts` : round-trip org/user/workspaces, `exportAll`/`importAll` produit un JSON re-importable.

### Type-check + lint

6. `bunx tsc --noEmit` clean. `bunx eslint src/` clean sur scope.

---

## Hors-scope explicite (v0.3.0+)

- Implémentation `TauriSqliteAdapter` (Tauri non-installé encore — interface uniquement).
- Multi-org / org-switcher.
- Org delete (destructif).
- Sync remote agent SQLite (backup hors-machine).
- OAuth login multi-device.
- Page `/org/:id/settings` au-delà du nom/logo (membres, billing, etc.).
