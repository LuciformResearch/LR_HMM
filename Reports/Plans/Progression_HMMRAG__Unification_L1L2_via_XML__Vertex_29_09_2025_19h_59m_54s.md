title: "Progression HMMRAG — Unification L1/L2 via XML + Vertex"

# Progression HMMRAG — Unification L1/L2 via XML + Vertex

Date: 2025-09-29T19:59:54+02:00
Category: Plans
Tags: hmm,l1,l2,vertex,xml,pipeline

## Contexte
Nous avons stabilisé:
- L1 via Vertex AI avec `@google/genai`, prompt ShadeOS, style miroir, `--min-summary` + retry (anti‑troncature).
- L2 avec overflow configurable (`--overflow-mode accept|regenerate`), soft‑target ajustable, `--concurrency` par groupes.

Objectif: unifier L1 et L2 autour d’un moteur XML commun pour outputs structurés (summary + entités), pour ingestion DB/RAG.
## Objectifs
1) Ajouter `--structured-xml true` à L1 (format `<l1>` minimal compatible L2).
2) Factoriser un « xmlEngine » partagé L1/L2 (prompt builder + appel Vertex + validations).
3) Harmoniser validations (min/max, retry) et fallbacks (heuristique si XML invalide, optionnels).
4) Conserver performance (concurrency 16–33) et traçabilité (logs + dumps prompts/outputs).
## Changements / Analyses
Décisions:
- Schéma L1 proposé:
  - `<l1 version="1" minChars="" maxChars="">`
    - `<summary><![CDATA[...]]></summary>`
    - `<tags><tag>...</tag></tags>` (3–10)
    - `<entities><persons/><orgs/><places/><times/></entities>` (textes simples)
    - `<mentions>` libre (APIs, fichiers, erreurs) — optionnel
    - `<covers>` indices de messages — optionnel
- Moteur partagé:
  - Prompt paramétrique (mode l1|l2), bornes dynamiques, style miroir.
  - Appel Vertex via `@google/genai` (ADC), `maxOutputTokens` ajustables.
  - Validations: min/max, ratio (si utile), retry 1x avec cible plus ferme.
  - Fallbacks: heuristique (stitched) si autorisé.
- Performance: légère hausse latence par prompt XML; compensée par `--concurrency` élevé.
## Résultats / Prochaines étapes
Prochaines étapes (implémentation incrémentale):
1. L1: ajouter flag `--structured-xml` + prompt XML + parsing Luciform (sans casser le flux actuel).
2. Extraire un util commun `xmlEngine` (prompt builder, call, validations, fallbacks) et réutiliser côté L2.
3. Normaliser entités (dates/lieux/personnes) via post‑traitement léger.
4. Option DB: mapper L1 entities dans les tables existantes (si requis).
5. Run E2E: L1 structuré + L2 + RAG/Composer; mesurer latence vs qualité.

Notes de perf:
- L1 Vertex `--concurrency 33`: ~44–47s pour 141 blocs (ok).
- L2: viser `--concurrency 4–8` initialement; ajuster selon quotas.
*Rapport généré par new_report*
