Regenerate Context — HMM Unified Summarize (04 Oct 2025 14:38 CET)

This is a quick handoff to resume the work smoothly.

Where To Look First
- Unified core: `src/lib/hmm/unified.ts`
  - Types: `RawDataBlock`, `LSummary`, `SummarizeEngineOptions`, `LengthPolicies`.
  - Length helpers: `computeLengthPlan()` / `evaluateLengthOutcome()` (ratio-only vs absolute bands).
  - Summarizers: `summarizeBlocks()` (L1, root `<l1>`) and `summarizeSummaryGroups()` (Lk, root `<l{level}>`).
  - Facades: `summarize(...)`, `summarizeBatched(...)` (pacing + `onlyIndices`).
  - Channel prep: `prepareBlocksChat(...)`, `preparePrompt()`.
- XML engine: `src/lib/summarization/xmlEngine.ts`
  - Unified schema `<lN>`; `<summary targetLen="...">`, `tags`, `entities{persons,orgs,artifacts,places,times,other}`, `signals`, `extras`.
  - Prompt refactor: role/situation rules; ratio-only applies to `<summary>` only. For L2+ the “Situation” now states it summarizes “résumés de ${baseDocType}” (no hardcoded “conversations de chat”), using level-1 mention.
- XML helpers: `src/lib/hmm/xmlHelpers.ts` (parseTags/parseEntities incl. `others`, parseExtras, getText/collectText).
- CLI (unified): `scripts/compress_memoryv2.ts`
  - New `--group-chars` to group Lk by total char budget (no mid-item cuts); fallback `--group-size` kept.
  - Replaced `--from-l1` with `--in` (multi-level). If omitted, auto-deduces previous level artefact `artefacts/HMM/compressed/<slug>.l{level-1}.v2.json`.
  - For L2+, “Documents” preformat uses `- ${persona}: {summary}` lines (matches prompt rework).

RAG Additions (new)
- Types & Interfaces: `src/lib/rag/types.ts` (IRagQuery, RagPolicy, IRagIndex, IEmbedder, Candidate).
- Postgres index: `src/lib/rag/indexPg.ts` (pgvector search level-aware, covers-only drill-down Lk→L1 via `idx`).
- Embedders: `src/lib/rag/embedder.ts` (Vertex via GoogleAuth, Studio via API key).
- Pipeline CLI: `scripts/rag_answer.ts`
  - Intent → policy presets (synthesis/detail/recent), initial search (levels), drill-down covers-only to L1, rerank stage1 + stage2 (MMR), compose High/Low.
  - `--export` writes bundle JSON to `artefacts/HMM/rag_context/<slug>/rerank_<ts>.json`.

Schema/DB Sync (new)
- Codegen schema: `scripts/schema_codegen.ts` → `sql/generated/ensure.sql` (conversations, summaries with `idx/content_hash`, embeddings vector(dim)+ivfflat, contexts) with safe ALTERs for legacy.
- Sync CLI: `scripts/db_sync.ts` → `ensure | upsert --in <artefact> | embed [--vertexai|Studio]`.
- Drizzle basics added: `src/lib/db/schema.ts`, `src/lib/db/client.ts` (migrations wiring WIP).

Current Status
- L1 (v2) OK: `artefacts/HMM/compressed/2025-06-25__orage_codé_textuel.l1.v2.json`.
- L2 (v2) OK: produced with updated prompts (Situation generalized + persona-prefixed items).
- L3 (v2) OK: produced with `--group-chars` + auto previous-level input.
- RAG pipeline OK (local): embeddings generated for L2+L1; search+drilldown+rerank+compose working; export bundle JSON present.

How To Run (current scripts)
- Env (`.env.local`):
  - `GOOGLE_APPLICATION_CREDENTIALS=secrets/<adc>.json`
  - `GOOGLE_CLOUD_PROJECT` or `PROJECT_ID` (optional)
  - `VERTEX_LOCATION=europe-west1`
  - Optional: `GEMINI_API_KEY` (Studio fallback)

- L1 (v2):
  - `npx tsx scripts/compress_memoryv2.ts --slug <slug> --level 1 --vertexai true --model gemini-2.5-flash --profile chat_assistant_fp --persona-name ShadeOS --role-map "assistant=ShadeOS,user=Lucie" --window-chars 4000 --min-summary 250 --max-summary 400 --ratio-only false --concurrency 20 --batch-delay-ms 1500 --engine-retry-attempts 1 --log`

- L2 (v2, ratio-only + budgeted groups):
  - `npx tsx scripts/compress_memoryv2.ts --slug <slug> --level 2 --group-chars 10000 --in artefacts/HMM/compressed/<slug>.l1.v2.json --vertexai true --model gemini-2.5-flash --ratio-only true --target-ratio 0.15 --wiggle 0.2 --overflow-mode accept --short-mode accept --concurrency 20 --max-output-tokens 4096 --engine-retry-attempts 1 --log`

- L3 (v2, same pattern):
  - `npx tsx scripts/compress_memoryv2.ts --slug <slug> --level 3 --group-chars 10000 --vertexai true --model gemini-2.5-flash --ratio-only true --target-ratio 0.15 --wiggle 0.2 --overflow-mode accept --short-mode accept --concurrency 20 --max-output-tokens 4096 --engine-retry-attempts 2 --log`

- Debug prompts (no API):
  - Append `--debug-prompt true --prompt-file artefacts/prompts/<slug>.<ts>.prompts.txt`

- DB (local pgvector):
  - `docker compose -f docker-compose.db.yml up -d`
  - `npx tsx scripts/schema_codegen.ts --dim 768`
  - `npm run db:ensure`
  - `npm run db:upsert -- --in artefacts/HMM/compressed/<slug>.l2.v2.json`
  - `npm run db:embed -- --slug <slug> --vertexai true --embed-model text-embedding-004 --where-level 2 --limit 200`
  - (Optional for L1) `npm run db:upsert -- --in artefacts/HMM/compressed/<slug>.l1.v2.json && npm run db:embed -- --slug <slug> --vertexai true --embed-model text-embedding-004 --where-level 1 --limit 500`

- RAG (pipeline + export bundle):
  - `npm run rag:answer -- --slug <slug> --query "..." --vertexai true --intent synthesis`
  - With export: add `--export` (default path: `artefacts/HMM/rag_context/<slug>/rerank_<ts>.json`)

Approvals / Escalations
- Vertex (network) + ADC required; scripts load `.env.local` automatically (dotenv).
- DB: local docker compose provided.

Notes
- Concurrency = request chunk size; pacing between chunks via `--batch-delay-ms` (script) and `paceDelayMs/retry*` (xmlEngine).
- Ratio-only applies target/soft bounds only to `<summary>`; cap omitted when `ratio-only`.
- L2+ “Situation” now correctly states we summarize “résumés de ${baseDocType} (basé sur L{level-1})”.
- L2+ “Documents” are prefixed as `- ${persona}: ...` per prompt rework.
- Grouping Lk: prefer `--group-chars` to avoid arbitrary counts.
- `--in` resolves the input artefact path for any level (auto previous-level if omitted).

Files Modified/Added This Session (highlights)
- Summarization: `scripts/compress_memoryv2.ts`, `src/lib/hmm/unified.ts`, `src/lib/summarization/xmlEngine.ts`.
- RAG: `src/lib/rag/types.ts`, `src/lib/rag/indexPg.ts`, `src/lib/rag/embedder.ts`, `scripts/rag_answer.ts`.
- DB sync: `scripts/schema_codegen.ts`, `scripts/db_sync.ts`, `src/lib/db/schema.ts`, `src/lib/db/client.ts`.
- Runbook: `Reports/Runbooks/Runbook_RAG_Ideal_Pipeline.md`.

Next Steps (roadmap immédiate)
- Prompt de réponse (chat) côté script: composer un prompt final avec X derniers duos (sans couper), puis “Mémoire long-terme: ” + bundle exporté (High/Low), puis le message de Lucie; sans appel LLM (mode prompt-only d’abord).
- Drizzle: compléter le schéma TS, générer migrations, et porter les requêtes SQL restantes.
- RAG: affiner reranking (stage2), recency features, diversity tuning; ajouter export annoté prêt à injecter.
- Tests/metrics: simple intégration pour hit-rate/MRR et logs de pipeline.

