Regenerate Context — HMM Unified Summarize (Oct 2025)

This is a quick handoff to resume the work smoothly.

Where To Look First
- Unified core: `src/lib/hmm/unified.ts`
  - Types: `RawDataBlock`, `LSummary`, `SummarizeEngineOptions` (now with `generateSignals`, `generateExtras`), `LengthPolicies`.
  - Length helpers: `computeLengthPlan()`, `evaluateLengthOutcome()`.
  - Summarizers: `summarizeBlocks()` (L1, root `<l1>` forcé) et `summarizeSummaryGroups()` (Lk, root dynamique `<l{level}>`).
  - Channel prep: `prepareBlocksChat/Document/Email`, `preparePrompt()`.
- XML engine: `src/lib/summarization/xmlEngine.ts`
  - Unified schema for all levels: dynamic root `<lN>` (N=1..k), union fields: `summary`, `tags`, `entities{persons,orgs,artifacts,places,times}`, `signals`, `extras`.
  - Pacing/backoff: `paceDelayMs`, `retry*`; toggles: `includeSignals`, `includeExtras`.
- XML helpers: `src/lib/hmm/xmlHelpers.ts` (getText/collectText/parse*).
- Legacy compressor: `src/lib/hmm/compressor.ts` (référence seulement).

Current Status (end of session)
- Schema unifié dynamique `<lN>` en place, options `includeSignals/includeExtras` branchées (via `generateSignals/generateExtras`).
- Unified API opérationnelle (blocks et groups). Préparation par canal (chat/doc/email) disponible.
- Helper commun `summarizeText(...)` câblé; `summarizeBlocks()` et `summarizeSummaryGroups()` l'utilisent.
- Façade haut niveau `summarize(input, engine, policies, opts)` ajoutée (dispatch L1 vs Lk).

Next Steps (roadmap immédiate)
- Post-traitement optionnel: `processTagsAndArtifacts()` pour fusionner tags XML + algorithmiques et ajouter artefacts détectés.
- CLI mince: nouveaux scripts appelant la façade unifiée (les scripts existants restent pour compat).
  - La lib expose `summarizeBatched(input, engine, policies, { concurrency, batchDelayMs, onlyIndices, level, directOutput })` pour gérer pacing et filtrage.

How To Run (current scripts)
- `.env.local` (git-ignored) requis:
  - `GOOGLE_APPLICATION_CREDENTIALS=secrets/<adc>.json`
  - `PROJECT_ID` ou `GOOGLE_CLOUD_PROJECT`
  - `VERTEX_LOCATION` (e.g. `europe-west1`)
  - Optionnel: `GEMINI_API_KEY` pour fallback Studio
- L1 (structuré + pacing/backoff):
  - npx tsx scripts/compress_memory.ts --slug 2025-06-25__orage_codé_textuel --vertexai true --model gemini-2.5-flash --structured true --structured-xml true --profile chat_assistant_fp --persona-name ShadeOS --role-map "assistant=ShadeOS,user=Lucie" --window-chars 4000 --min-summary 250 --max-summary 400 --short-mode regenerate --concurrency 20 --batch-delay-ms 3000 --max-output-tokens 1024 --allow-heuristic-fallback true --engine-retry-attempts 3 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300
- L2:
  - npx tsx scripts/compress_memory_l2.ts --slug 2025-06-25__orage_codé_textuel --vertexai true --model gemini-2.5-flash --group-size 5 --concurrency 8 --use-xml-engine true --l2-multiplier 1.5 --l2-soft-target 1.0 --l2-wiggle 0.2 --overflow-mode regenerate --overflow-max-ratio 2.0 --soft-ratio-step 0.3 --hard-min 300 --max-output-tokens 8192 --call-timeout-ms 35000 --engine-retry-attempts 3 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300 --log

Approvals / Escalations
- Vertex (réseau) + ADC requis; scripts chargent `.env.local` automatiquement (dotenv).
- Fallback Studio via `GEMINI_API_KEY` si nécessaire.
- DB locale (si besoin RAG): `docker compose -f docker-compose.db.yml up -d`.

Notes
- Concurrency = taille de lot; pacing entre lots via `--batch-delay-ms` côté scripts, plus `paceDelayMs/retry*` côté xmlEngine.
- `generateSignals` et `generateExtras` permettent d’ajuster la structure de sortie sans dépendre du niveau.

Files Modified This Session
- src/lib/hmm/unified.ts, src/lib/summarization/xmlEngine.ts, src/lib/hmm/xmlHelpers.ts, README.md, REGENERATE_CONTEXT.md.

New Scripts
- `scripts/compress_memoryv2.ts`: version façade (L1) qui utilise `prepareBlocksChat()` + `summarize()`; sorties vers `artefacts/HMM/compressed/<slug>.l1.v2.json`.
  - Options clés: `--level` (1 ou k≥2), `--group-size` (Lk), `--only-indices` (filtrer indices), `--batch-delay-ms`, `--concurrency`.
