title: "HMM L1/L2 Abstraction via xmlEngine — Safe Plan"

# HMM L1/L2 Abstraction via xmlEngine — Safe Plan

Date: $(date -Is)
Category: Plans
Tags: hmm,abstraction,l1,l2,xmlEngine,plan

## Contexte

- L1 via xmlEngine: résumés par fenêtres, `--structured-xml` produit XML riche, sinon `directOutput` via le même moteur; support profil/persona, role-map, naming policy.
- L2 via xmlEngine: agrège L1 par groupes, calcule bornes dynamiques (target, wiggle, cap), gère overflow (accept/regenerate) avec soft-target; fallback heuristique si XML manquant.
- Utilitaires dupliqués: `runPool` existe dans L1/L2; L2 a un logger simple; L1 gère `--only-indices` (régénération partielle) localement; politique d’underflow L1 (minSummary + retry) et d’overflow L2 (regenerate/accept) sont parallèles mais séparées.
- `xmlEngine` couvre déjà L1/L2, profils/persona, `directOutput`, hints de longueur (target/cap), naming policy.

## Objectifs

- Un noyau unique "Hierarchical Memory Compressor" paramétrable (classe) orchestrant L1 et L2 avec les mêmes primitives: profils/persona, normalisation, moteur XML, politiques de longueur/retry.
- Scripts CLI réduits à des façades vers la lib, sans duplication.
- Abstraire les politiques de longueur (bounds) et overflow/underflow pour L1/L2.
- Conserver rétrocompatibilité des options et sorties (L1/L2).

## Changements / Analyses

- Points communs: pool de concurrence, stratégie de longueur (min/max/soft/cap), retries, extraction XML via `LuciformXMLParser`, schémas l1/l2, options Vertex/Studio.
- Différences: construction des fenêtres (L1) vs groupes (L2), logger (L2 seulement), underflow L1 vs overflow L2, régénération partielle L1.

- Étape 1 — Extraire les utilitaires partagés (sans changement de comportement)
  - `src/lib/hmm/runPool.ts`: facteur commun de `runPool` (mêmes semantics).
  - `src/lib/hmm/bounds.ts`: helpers de bornes L2 (target, wiggle, cap, soft-target) + helper L1 (ratio→taille cible).
  - `src/lib/hmm/policies.ts`:
    - L1 underflow handler: minSummary + mode `accept|regenerate|error`.
    - L2 overflow handler: mode `accept|regenerate` + `overflowMaxRatio` + `softRatioStep`.
  - `src/lib/hmm/logger.ts`: reprend `createLogger` L2, optionnel pour L1.
  - `src/lib/hmm/types.ts`: `ParsedMessage`, `L1Summary`, `L2Summary`, etc.
  - Scripts L1/L2: remplacer impls inline par ces imports (comportement inchangé).

- Étape 2 — Adapters + unification prompts
  - `src/lib/hmm/adapters/chatAdapter.ts`: rôle→affichage (roleMap), `allowedNames`, rendu documents → `xmlEngine` (L1/L2).
  - `xmlEngine` reste le backend unique; L1 non-structuré via `directOutput: true`.

- Étape 3 — Classe `HierarchicalMemoryCompressor` (MVP)
  - `compressL1(parsed, opts)`: fenêtres + underflow policy + structured/direct; réutilise `xmlEngine`, `runPool`, `policies`.
  - `regenerateL1Subset(prev, indices, opts)`: régénération partielle par `index` (introduire `blockId` plus tard).
  - Refactor `scripts/compress_memory.ts` pour appeler la classe (CLI = façade).

- Étape 4 — L2 dans la même classe
  - `compressL2(l1, opts)`: groupes, `bounds`, overflow/retry unifiés, `xmlEngine` par défaut; fallback heuristique sous flag.
  - `regenerateL2Subset(prev, indices, opts)`.
  - Refactor `scripts/compress_memory_l2.ts` pour appeler la classe.

- Étape 5 — Validation légère
  - Validation L1/L2 (forme, longueurs, présence `<l1>`/`<l2>`), vérification des noms vs `allowedNames` selon `namingPolicy` (warn/throw).

- Étape 6 — Documentation
  - README lib/CLI: usage, `--only-indices`, profils/persona, naming policy, options de bounds/overflow/underflow.

- Raisons "safe + rapide"
  - Isolation des fonctions stables → lib, puis enveloppe via classe; aucune réécriture profonde.
  - Moteur unique (`xmlEngine`) pour L1/L2; mêmes politiques; moins de duplication.
  - Scripts conservés (mêmes args/sorties) mais amincis.

- Détails L1
  - Conserver `structured-xml` et `directOutput`; déplacer `buildPrompt`/retry underflow dans `policies.ts`.
  - Centraliser `--only-indices` dans la classe (option `subsetIndices`).

- Détails L2
  - Déplacer calcul des bornes (avgChars, target, wiggle, cap, soft-target) et overflow/retry dans la lib.
  - Garder le fallback heuristique sous `allowHeuristicFallback`.

- `xmlEngine`
  - Déjà prêt: `mode: 'l1'|'l2'`, `profile/persona`, `namingPolicy`, `hintTarget`/`hintCap`, `directOutput`.
  - Optionnel: parse helper générique (sinon `LuciformXMLParser` côté lib).

## Résultats / Prochaines étapes

- Démarrer Étape 1 (extraction utilitaires) et refactor minimal de L1 pour consommer la lib.
- Ensuite appliquer la même abstraction à L2 et ajouter `regenerateL2Subset`.
- Prévoir escalades si nécessaire: accès Vertex/ADC hors workspace, écritures artefacts/logs/exports, réseau local DB, `npm install` pour libs utilitaires.

*Rapport généré par new_report*
