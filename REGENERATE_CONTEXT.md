Regenerate Context — HMM Unified Summarize (Oct 2025)

This is a quick handoff to resume the work smoothly.

Where To Look First
- Unified core: `src/lib/hmm/unified.ts`
  - Types: `RawDataBlock`, `LSummary` (entities inclut `others`), `SummarizeEngineOptions` (log/logFile, debugPrompt/promptOutFile, generateSignals/generateExtras), `LengthPolicies`.
  - Length helpers: `computeLengthPlan()` (clamp target → band par wiggle), `evaluateLengthOutcome()` (retry step en chars).
  - Summarizers: `summarizeBlocks()` (L1, root `<l1>`) et `summarizeSummaryGroups()` (Lk, root dynamique `<l{level}>`).
  - Facades: `summarize(...)` et `summarizeBatched(...)` (pacing + `onlyIndices`).
  - Channel prep: `prepareBlocksChat/Document/Email`, `preparePrompt()`.
- XML engine: `src/lib/summarization/xmlEngine.ts`
  - Unified schema `<lN>`; `<summary targetLen="...">`, `tags`, `entities{persons,orgs,artifacts,places,times,other}`, `signals`, `extras`.
  - Prompt refactor: Rôle/Situation/(Conversation avec ...), règles <summary> (1ʳᵉ pers., factuel, pas de tu/vous hors citation), longueur appliquée à <summary> uniquement.
  - Cap dur conditionnel: affiché seulement si non `ratio-only`.
  - Pacing/backoff: `paceDelayMs`, `retry*`. Debug prompts: `debugPrompt`/`promptOutFile` (pas d'appel API).
- XML helpers: `src/lib/hmm/xmlHelpers.ts` (parseTags/parseEntities inclut `others`, parseExtras, getText/collectText).
- Legacy compressor: `src/lib/hmm/compressor.ts` (référence seulement).

Current Status (end of session)
- Schéma structuré unifié `<lN>` (+ `other` sous `entities`), prompts refactorés.
- API unifiée L1/Lk opérationnelle; helper `summarizeText(...)` câblé; facades `summarize(..)`/`summarizeBatched(..)`.
- Ratio-only: objectif longueur appliqué à `<summary>` uniquement; cap dur omis; tokens dynamiques.
- Logging riche + debug-prompts.
- Traçabilité: chaque `LSummary` inclut maintenant `index` (position dans `summaries[]`) pour faciliter les régénérations ciblées.

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
- L1 (v2, structuré):
  - npx tsx scripts/compress_memoryv2.ts --slug 2025-06-25__orage_codé_textuel --level 1 --vertexai true --model gemini-2.5-flash --profile chat_assistant_fp --persona-name ShadeOS --role-map "assistant=ShadeOS,user=Lucie" --window-chars 4000 --min-summary 250 --max-summary 400 --short-mode regenerate --overflow-mode regenerate --concurrency 20 --batch-delay-ms 3000 --max-output-tokens 1024 --engine-retry-attempts 2 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300 --log
- L1 (v2, ratio-only):
  - npx tsx scripts/compress_memoryv2.ts --slug 2025-06-25__orage_codé_textuel --level 1 --ratio-only true --target-ratio 0.10 --short-mode accept --overflow-mode accept --vertexai true --model gemini-2.5-flash --window-chars 4000 --concurrency 20 --batch-delay-ms 1500 --engine-retry-attempts 1 --profile chat_assistant_fp --persona-name ShadeOS --role-map "assistant=ShadeOS,user=Lucie" --log
- L2 (v2):
  - npx tsx scripts/compress_memoryv2.ts --slug 2025-06-25__orage_codé_textuel --level 2 --group-size 5 --from-l1 artefacts/HMM/compressed/2025-06-25__orage_codé_textuel.l1.v2.json --vertexai true --model gemini-2.5-flash --target-ratio 0.15 --wiggle 0.2 --overflow-mode regenerate --underflow-mode regenerate --concurrency 8 --max-output-tokens 4096 --call-timeout-ms 35000 --engine-retry-attempts 2 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300 --log

Approvals / Escalations
- Vertex (réseau) + ADC requis; scripts chargent `.env.local` automatiquement (dotenv).
- Fallback Studio via `GEMINI_API_KEY` si nécessaire.
- DB locale (si besoin RAG): `docker compose -f docker-compose.db.yml up -d`.

Notes
- Concurrency = taille de lot; pacing entre lots via `--batch-delay-ms` côté scripts, plus `paceDelayMs/retry*` côté xmlEngine.
- `generateSignals` et `generateExtras` ajustent la structure indépendamment du niveau.
- Debug-prompt: `--debug-prompt true` + `--prompt-file` écrit le prompt exact (et n’appelle pas l’API) dans `artefacts/prompts/...`.
- Logging détaillé dans `artefacts/logs/...` (tentatives, backoff, hasRoot, plans).
- Timestamps & durée: logs horodatés en CET, avec `+Xs` (since start) et progression par lot (`batch i/n done items=x/y`).
- Remarques temporelles: des pauses perçues peuvent refléter la latence Vertex/planification des lots; se référer aux marqueurs `+Xs` et aux lignes de progression pour valider l’avancement.

Files Modified This Session
- src/lib/hmm/unified.ts, src/lib/summarization/xmlEngine.ts, src/lib/hmm/xmlHelpers.ts, README.md, REGENERATE_CONTEXT.md.

New Scripts
- `scripts/compress_memoryv2.ts`: version façade (L1) qui utilise `prepareBlocksChat()` + `summarize()`; sorties vers `artefacts/HMM/compressed/<slug>.l1.v2.json`.
  - Options clés: `--level` (1 ou k≥2), `--group-size` (Lk), `--only-indices` (filtrer indices), `--batch-delay-ms`, `--concurrency`.
  - Logging: `--log` et `--log-file` (défaut: `artefacts/logs/<slug>.<timestamp>.run.log`).
  - Debugging prompts: `--debug-prompt true` et `--prompt-file` (défaut: `artefacts/prompts/<slug>.<timestamp>.prompts.txt`). En mode debug, le moteur écrit les prompts et n'appelle pas l'API.
- `scripts/patch_l1_add_index.ts`: patch utilitaire pour ajouter `index` aux éléments de `summaries[]` d’un JSON L1 existant (sans relancer Vertex).
  - Usage:
    - In-place: `npx tsx scripts/patch_l1_add_index.ts --slug <slug> --in-place true`
    - Fichier arbitraire: `npx tsx scripts/patch_l1_add_index.ts --in artefacts/HMM/compressed/<slug>.l1.json --out artefacts/HMM/compressed/<slug>.l1.patched.json`
    - Dry-run: `--dry-run true` (rapporte combien d’indices seraient ajoutés)
