title: "Plan Update — HMM L1/L2 via xmlEngine — 01/10 15:32"

# Plan Update — HMM L1/L2 via xmlEngine — 01/10 15:32

Date: 2025-10-01T15:42:08+02:00
Category: Plans
Tags: hmm,plan,l1,l2,xmlEngine,update

## Contexte
Depuis le plan de 08h36, l’architecture HMM a été unifiée autour d’une classe `HierarchicalMemoryCompressor` (L1/L2) et du moteur `xmlEngine`. Le parser XML interne a été remplacé par le package npm `@luciformresearch/xmlparser`. Les scripts CLI ont été branchés sur la classe pour supprimer la duplication et fiabiliser les politiques de longueur (underflow/overflow), tout en conservant l’ergonomie des options existantes.
## Objectifs
- Centraliser L1/L2 dans la classe (fenêtrage, bornes, politiques de longueur, parsing XML).
- Garder l’interface CLI et la rétro‑compatibilité des options/sorties.
- Réduire la surface legacy et la duplication (prompts inline, appels directs Vertex/Studio côté scripts).
- Préparer un nettoyage final du parser local et du code non utilisé après validation.
## Changements / Analyses
- Parser XML
  - Installation et adoption de `@luciformresearch/xmlparser` (remplace `src/lib/xml-parser/*` côté usage).
  - Test d’intégration ciblé: `scripts/tmp_xmlparser_test.ts` OK (root, CDATA, `findElement`, `findAllElements`).

- Lib HMM (déjà en place, consolidée)
  - `src/lib/hmm/compressor.ts`: 
    - L1: `windowL1`, `summarizeL1Blocks` (structured XML ou `directOutput`), underflow policy + retry, fallback heuristique.
    - L2: `groupL1`, `summarizeL2Groups` (bornes via `computeL2Bounds`, overflow accept/regenerate, retry soft‑target, fallback heuristique).
  - Utilitaires: `runPool`, `bounds`, `policies`, `logger`, `adapters/chatAdapter`, `types`.

- Scripts CLI
  - L1: `scripts/compress_memory.ts`
    - Simplifié pour utiliser `HierarchicalMemoryCompressor` (fenêtrage + résumé), `--only-indices` conservé (réutilise L1 précédent pour blocs non sélectionnés).
    - Enrichissement algorithmique (tags/artifacts) maintenu via `@/lib/extractors/artifacts`.
    - Dépendances legacy retirées du chemin actif (node-fetch, prompts manuels, parsing XML direct). Copie de référence: `scripts/_legacy.compress_memory.ts`.
  - L2: `scripts/compress_memory_l2.ts`
    - Grouping via `groupL1`, résumé via `summarizeL2Groups`, logging via `createLogger`.
    - Options overflow/bornes exposées (l2Multiplier, l2Wiggle, hardMin, l2SoftTarget, overflowMode, overflowMaxRatio, softRatioStep, allowHeuristicFallback).
    - Copie de référence: `scripts/_legacy.compress_memory_l2.ts`.

- Compat/usage
  - Options CLI conservées; Persona/`roleMap`; `--structured-xml` vs `directOutput`; `--target-ratio`; `--min-summary`/`--short-mode` pour L1.
  - Vertex/Studio géré dans la lib (timeouts, tokens max). Les fetchs modèle auto‑window ont été retirés du script L1 (pas critiques).
## Résultats / Prochaines étapes
- État actuel
  - L1/L2 opérationnels via la classe; nouveau parser npm validé; scripts allégés et cohérents.
  - Copies legacy conservées pour audit/rollback ciblé si besoin.

- À faire (rapide)
  - Exécuter une passe L1 puis L2 sur un artefact existant pour valider le chemin complet (underflow/overflow, tags/entities).
  - Si OK: nettoyer définitivement le code legacy dans les scripts et archiver/supprimer `src/lib/xml-parser/*` (après confirmation).
  - Mettre à jour un README d’usage (CLI + lib) et noter la dépendance `@luciformresearch/xmlparser`.

*Note:* le plan 08h36 est dépassé; ce rapport reflète l’état 15h32+ avec unification effective et migration parser finalisée côté usage.
*Rapport généré par new_report*
