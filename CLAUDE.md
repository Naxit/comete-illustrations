# CLAUDE.md — comete-illustrations

## Projet

Bibliothèque d'illustrations vectorielles Comète, publiée en tant que composants React.
Les illustrations sont utilisées pour habiller les états contextuels de l'application :
empty states, onboarding, erreurs, succès, etc.

## Stack

- React 18/19, TypeScript strict, ESM only
- SVGO 3 pour l'optimisation SVG (couleurs préservées, pas de currentColor)
- tsup pour le build
- Biome pour le lint/format
- Vitest pour les tests
- pnpm comme package manager
- Publication sur GitHub Packages (@naxit scope)

## Architecture

```
scripts/          → Pipeline Figma → SVG → React
  fetch-illustrations.ts   → Télécharge les SVGs depuis Figma API
  optimize-svg.ts          → Optimise avec SVGO (garde les couleurs)
  generate-components.ts   → Génère les composants React + types + barrel
src/              → Code source (auto-généré)
  illustrations/  → Un composant .tsx par illustration
  types.ts        → IllustrationProps, IllustrationName, IllustrationCategory
  registry.ts     → Mapping nom → composant + catégorisation
  index.ts        → Barrel export
svg/              → SVGs bruts depuis Figma (pas dans git)
```

## Différences avec comete-icons

- **Couleurs préservées** : les illustrations sont multicolores, pas de remplacement par currentColor
- **Pas de variants** : pas de outlined/filled/duotone — chaque illustration est unique
- **Pas de tailles fixes** : pas de 16/24px — les illustrations utilisent viewBox et se redimensionnent librement via width/height
- **Catégories** : les illustrations sont catégorisées par usage (empty-state, error, onboarding, etc.)
- **Props simplifiées** : width, height, className, aria-label — pas de color/variant/spacing

## Pipeline

```bash
pnpm pipeline        # Sync Figma → Optimise → Génère → Build
pnpm figma:sync      # Télécharge depuis Figma (incrémental)
pnpm optimize        # SVGO sur svg/
pnpm generate        # Génère src/ depuis svg/
pnpm build           # tsup → dist/
```

## Conventions

- Frame Figma : `Category/NomEnPascalCase` ou `NomEnPascalCase`
- Nommage composants : PascalCase (ex: EmptyStateNoData, OnboardingWelcome)
- Les fichiers dans src/ sont auto-générés — ne pas éditer manuellement
- Le fichier .env contient FIGMA_TOKEN (secret, pas dans git)
