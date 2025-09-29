title: "Runbook — L1 XML Structured + Vertex AI"

# Runbook — L1 XML Structured + Vertex AI

Date: 2025-09-29T19:59:54+02:00
Category: RunBook
Tags: hmm,runbook,l1,vertexai,xml,pipeline

## Contexte
But: produire des L1 structurés (XML) alignés avec L2 pour faciliter extraction (tags/entités), QA et intégration RAG/DB.
Infra: Vertex AI (ADC), client `@google/genai`, parseur Luciform.
## Objectifs
1) Activer un mode L1 structuré XML optionnel.
2) Conserver la qualité narrative (ShadeOS, style miroir) avec contraintes de longueur stables.
3) Préparer l’abstraction commune L1/L2.
## Changements / Analyses
Paramètres clés (L1):
- `--vertexai true` — appelle Vertex via `@google/genai` (ADC requis).
- `--min-summary`, `--max-summary` — bornes de longueur; retry si court.
- `--short-mode regenerate|accept|error` — stratégie sous‑longueur.
- `--concurrency N` — parallélisme (33 validé côté Studio; 16–24 recommandé Vertex).
- `--structured-xml true` — active le prompt XML + parsing Luciform (à venir).
- `--allow-heuristic-fallback` — fallback heuristique si XML invalide.

Paramètres L2 (rappel utile):
- `--concurrency` — parallélise les groupes.
- `--overflow-mode accept|regenerate`, `--overflow-max-ratio`, `--soft-ratio-step` — gestion dépassement.
## Résultats / Prochaines étapes
Commandes de référence (actuelles):

1) L1 (Vertex, non‑XML, stable)
```
# Option A: via .env.local (recommandé)
# Créez .env.local (ignoré par git) avec:
# GOOGLE_APPLICATION_CREDENTIALS=secrets/lr-hub-472010-17b9f2d37953.json
# PROJECT_ID=lr-hub-472010
# GOOGLE_CLOUD_PROJECT=lr-hub-472010
# VERTEX_LOCATION=europe-west1
# LOCATION=europe-west1

# Option B: export direct dans le shell
# export GOOGLE_APPLICATION_CREDENTIALS=secrets/lr-hub-472010-17b9f2d37953.json
# export PROJECT_ID=lr-hub-472010; export GOOGLE_CLOUD_PROJECT=$PROJECT_ID
# export VERTEX_LOCATION=europe-west1; export LOCATION=$VERTEX_LOCATION

npx tsx scripts/compress_memory.ts \
  --in artefacts/parsed/2025-06-25__orage_codé_textuel.json \
  --slug 2025-06-25__orage_codé_textuel \
  --structured true \
  --window-chars 4000 \
  --min-summary 250 --max-summary 400 --short-mode regenerate \
  --concurrency 16 \
  --vertexai true --model gemini-2.5-flash \
  --timeout-ms 20000
```

2) L2 (Vertex, groupes parallèles, overflow contrôlé)
```
npx tsx scripts/compress_memory_l2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash --fallback-model gemini-2.5-pro \
  --group-size 5 --concurrency 6 \
  --l2-multiplier 1.5 --l2-soft-target 1.0 --l2-wiggle 0.2 \
  --overflow-mode regenerate --overflow-max-ratio 2.0 --soft-ratio-step 0.3 \
  --hard-min 300 --max-output-tokens 8192 --call-timeout-ms 40000 \
  --log
```

Prochaines étapes (implémentation):
1) Ajouter `--structured-xml` à L1 avec `<l1>` (summary/tags/entities) + parse Luciform + retry minimal.
2) Factoriser `xmlEngine` partagé (builder + call + validations + fallback).
3) Exposer un exemple E2E (L1 structuré → L2 → RAG/Composer) et mesurer latence/qualité.

Livrables:
- Script L1 mis à jour + doc des flags.
- Rapport d’évaluation qualité (entités, stabilité) et perf.

Notes:
- Augmenter `--max-output-tokens` côté Vertex si nécessaire pour éviter coupures, sans gonfler inutilement la latence.
- Surveiller quotas Vertex lors de runs parallèles (16–24 recommandé, ajuster selon erreurs 429/aborts).
*Rapport généré par new_report*
