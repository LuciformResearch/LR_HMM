title: "Roadmap — Unified Summarize API (L1..Lk)"

# Roadmap — Unified Summarize API (L1..Lk)

Date: 2025-10-02T11:35:38+02:00
Category: Plans
Tags: hmm,plan,summarize,unified,xmlEngine

## Contexte
L’insight “Unified Summarize” vise à proposer une API unique et simple pour générer des résumés multi‑niveaux (L1..Lk) en réutilisant un même cœur (mêmes politiques de longueur, même moteur XML, mêmes sorties structurées), tout en laissant la préparation des blocs/contextes (chat, document, email) configurable en amont. Le but est d’obtenir un usage haut‑niveau uniforme, indépendant du niveau de compression, avec des paramètres stables (compressionLevel, wiggle, under/overflow policies, regenerateRatioStep, summaryLenRange) et des sorties enrichies (tags/artefacts, entities, signals, extras) cohérentes.
## Objectifs
- Offrir une API unique `summarize()` opérant sur deux formes d’entrée:
  - `RawDataBlock[]` (L1: conversation, document, mail) après `prepareBlocks()` spécifique au canal.
  - `LSummary[]` (L2..Lk) pour agréger des niveaux inférieurs.
- Normaliser les paramètres: `compressionLevel`, `wiggle`, `overflowMode`/`underflowMode`, `regenerateRatioStep`, `summaryLenRange`, `allowHeuristicFallback`, `model`, `callTimeoutMs`.
- Unifier le prompting via `preparePrompt()` selon le canal (chat, document, email), exposer les personas/voice, et conserver un mode narratif first‑person pour chat.
- Produire une structure de sortie commune pour tous les niveaux: `summary`, `tags`, `entities (persons, orgs, artifacts, places, times)`, `signals`, `extras`.
- Conserver les extracteurs algorithmiques post‑traitement via `processTagsAndArtifacts()` (optionnel) pour compléter/valider les tags/artefacts.
## Changements / Analyses
- API haut‑niveau
  - `summarize(input: LSummary[] | RawDataBlock[], engine: SummarizeEngineOptions & LengthPolicies): LSummary[]`
  - Déduire `level` du contexte (L1 = RawDataBlock[], sinon Lk = LSummary[]).
  - `prepareBlocks(channel, options)` (chat/document/email) génère `RawDataBlock[]` + `promptHint` (narratif/voice) pour L1.
  - `preparePrompt(channel, persona)` uniformise l’adresse (first/third person), naming policy et style.

- Politiques de longueur (unifiées L1..Lk)
  - `compressionLevel` définit la cible: `target = round(totalChars * compressionLevel)`.
  - `wiggle` ajuste la tolérance autour de la cible; `summaryLenRange` cappe en dur min/max avant envoi au LLM.
  - Underflow/Overflow: `accept | regenerate`, avec `regenerateRatioStep` appliqué symétriquement (ex.: 0.6 → 0.7).
  - Implémentation: transformer ces paramètres en `minChars/maxChars` + `hintTarget/hintCap` pour xmlEngine.

- Moteur d’exécution
  - xmlEngine (déjà adopté): pacing/backoff intégrés; addressing + naming policy; schema structuré unifié L1/L2 (tags/entities/signals/extras).
  - Conserver `allowHeuristicFallback` (stitch first sentences) en dernier recours.
  - Concurrence: gérée au niveau appelant (chunk=concurrency) + `paceDelayMs` xmlEngine.

- Sortie structurée commune
  - L1 et L2+ retournent la même forme enrichie: `{ summary, tags, entities{persons,orgs,artifacts,places,times}, signals, extras }` + métriques (chars, ratio, quality, covers).
  - Post‑traitement optionnel: `processTagsAndArtifacts()` fusionne tags XML + tags algorithmiques, et ajoute artefacts détectés.

- Préparation de canaux (extensible, sans sur‑coder tout de suite)
  - `prepareBlocks('chat', { personaName, interlocutor, roleMap })`: remap roles, narratif en “je”, pas de “tu/vous”.
  - `prepareBlocks('document', { authorType, authorName | orgName })`: voix de rapport (je/nous selon type), métadonnées.
  - `prepareBlocks('email', { sender/recipient })`: voix adaptée (sender/recipient), mentions expéditrices.
  - Déployer d’abord ‘chat’, prévoir interfaces pour ‘document’/’email’.
## Résultats / Prochaines étapes
- Étape 1 — Définir l’API et les types
  - `SummarizeEngineOptions` (model, timeouts, pacing/backoff, naming/persona) + `LengthPolicies` (compressionLevel, wiggle, under/overflow, regenerateRatioStep, summaryLenRange, allowHeuristicFallback).
  - Types d’entrée: `RawDataBlock`, `LSummary` (unifié avec champs structurés).
  - Types de sortie: `LSummary` enrichi (tags/entities/signals/extras).

- Étape 2 — Adapter la lib existante
  - Dériver min/max/softTarget depuis `compressionLevel`, `wiggle`, `summaryLenRange` via un helper commun.
  - Injecter ces bornes dans les chemins L1/L2 actuels (remplacer usage direct de ratios spécifiques L1/L2).
  - Conserver xmlEngine (pacing/backoff) et unify schema (déjà en place).

- Étape 3 — `prepareBlocks()` et `preparePrompt()`
  - D’abord le canal ‘chat’ (rôles, narratif, style, naming). Poser interfaces pour ‘document’ et ‘email’ (sans implémentation complète).
  - Exposer `channel` et `promptHint` dans l’API; brancher vers xmlEngine.

- Étape 4 — `processTagsAndArtifacts()` (post‑traitement facultatif)
  - Déplacer l’enrichissement algorithmiquement dans une fonction dédiée; fusion raisonnée avec tags XML.
  - Hook optionnel après chaque `summarize()`.

- Étape 5 — CLI et scripts
  - Ajouter une façade `scripts/unified_summarize.ts` qui consomme l’API (L1 ou L2..Lk selon input) et garde la rétro‑compatibilité avec les scripts existants.
  - Introduire flags haut‑niveau (compressionLevel, wiggle, under/overflow, regenerateRatioStep, summaryLenRange) et les mapper vers l’API.

- Étape 6 — Validation et docs
  - Jeux d’essai L1/L2 (samples) et vérification des champs structurés + politiques de longueur.
  - Bench latence/coût: comparer concurrency/pacing/backoff; consigner recommandations dans README.
  - Documentation API + exemples par canal (chat d’abord).

Risques & atténuations
- Ambiguïtés entre `compressionLevel` et bornes historiques L2: solution via helper de conversion unique pour générer min/max/softTarget/cap.
- Dérives narratives: fixer prompts de canal (narratif en “je” pour chat, pas de “tu/vous”), et garder un mode neutre pour documents.
- Quotas API: pacing/backoff dans xmlEngine + chunk côté script.
*Rapport généré par new_report*
