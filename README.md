# @naxit/comete-illustrations

Bibliothèque d'illustrations vectorielles Comète — composants React pour les états contextuels (empty states, onboarding, erreurs, succès…).

## Installation

```bash
pnpm add @naxit/comete-illustrations
```

## Utilisation

```tsx
import { EmptyStateNoData } from "@naxit/comete-illustrations";

function MyEmptyState() {
  return (
    <div>
      <EmptyStateNoData width={240} aria-label="Aucune donnée disponible" />
      <p>Aucun résultat trouvé</p>
    </div>
  );
}
```

### Import individuel (tree-shaking)

```tsx
import { EmptyStateNoData } from "@naxit/comete-illustrations/illustrations/EmptyStateNoData";
```

### Registry (rendu dynamique)

```tsx
import { illustrationRegistry } from "@naxit/comete-illustrations";

function DynamicIllustration({ name }: { name: IllustrationName }) {
  const Component = illustrationRegistry[name];
  return Component ? <Component width={200} /> : null;
}
```

### Par catégorie

```tsx
import { illustrationsByCategory } from "@naxit/comete-illustrations";

// Lister toutes les illustrations d'une catégorie
const emptyStateNames = illustrationsByCategory["empty-state"];
```

## Props

| Prop         | Type               | Default     | Description                                     |
| ------------ | ------------------ | ----------- | ----------------------------------------------- |
| `width`      | `number \| string` | —           | Largeur en pixels. Proportionnel si seul défini. |
| `height`     | `number \| string` | —           | Hauteur en pixels. Proportionnel si seul défini. |
| `className`  | `string`           | —           | Classe CSS additionnelle.                        |
| `aria-label` | `string`           | —           | Label accessible. Si absent → décoratif.         |

## Pipeline Figma → React

Les illustrations sont synchronisées depuis Figma via l'API REST :

```bash
pnpm pipeline         # Sync + Optimize + Generate + Build
```

### Étapes détaillées

1. **`pnpm figma:sync`** — Télécharge les SVGs depuis le fichier Figma (incrémental via manifeste)
2. **`pnpm optimize`** — Optimise avec SVGO (nettoyage metadata, conservation des couleurs)
3. **`pnpm generate`** — Génère les composants React, types, registry et barrel
4. **`pnpm build`** — Compile via tsup → `dist/`

## Convention de nommage Figma

Les frames d'illustration suivent la convention :

- `Category/NomEnPascalCase` — avec catégorie (ex: `empty-state/NoData`)
- `NomEnPascalCase` — sans catégorie

## Stack

React 18/19 · TypeScript strict · SVGO 3 · tsup · Biome · Vitest · Figma source
