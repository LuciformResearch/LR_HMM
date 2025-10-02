Regenerate Context — HMM Unified Summarize (Oct 2025)

This is a quick handoff to resume the work smoothly.

Where To Look First
- Unified core: `src/lib/hmm/unified.ts`
  - Types: `RawDataBlock`, `LSummary`, `SummarizeEngineOptions`, `LengthPolicies`.
  - Helpers: `computeLengthPlan()`, `evaluateLengthOutcome()`.
  - Summarizers: `summarizeBlocks()` (L1 enforced), `summarizeSummaryGroups()` (L2..Lk).
  - Channel prep: `prepareBlocksChat/Document/Email`, `preparePrompt()`.
- XML engine: `src/lib/summarization/xmlEngine.ts`
  - Pacing/backoff: `paceDelayMs`, `retry*`.
  - Structured schema unified; toggles: `includeSignals`, `includeExtras`.
- XML helpers: `src/lib/hmm/xmlHelpers.ts`
- Legacy compressor still present: `src/lib/hmm/compressor.ts` (use for reference only).

How To Run (current scripts)
- Ensure `.env.local` (git-ignored) with:
  - `GOOGLE_APPLICATION_CREDENTIALS=secrets/<adc>.json`
  - `PROJECT_ID` or `GOOGLE_CLOUD_PROJECT`
  - `VERTEX_LOCATION` (e.g. `europe-west1`)
  - Optional: `GEMINI_API_KEY` for Studio fallback
- L1 example (structured, pacing + backoff):
  - npx tsx scripts/compress_memory.ts --slug 2025-06-25__orage_codé_textuel --vertexai true --model gemini-2.5-flash --structured true --structured-xml true --profile chat_assistant_fp --persona-name ShadeOS --role-map "assistant=ShadeOS,user=Lucie" --window-chars 4000 --min-summary 250 --max-summary 400 --short-mode regenerate --concurrency 20 --batch-delay-ms 3000 --max-output-tokens 1024 --allow-heuristic-fallback true --engine-retry-attempts 3 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300
- L2 example:
  - npx tsx scripts/compress_memory_l2.ts --slug 2025-06-25__orage_codé_textuel --vertexai true --model gemini-2.5-flash --group-size 5 --concurrency 8 --use-xml-engine true --l2-multiplier 1.5 --l2-soft-target 1.0 --l2-wiggle 0.2 --overflow-mode regenerate --overflow-max-ratio 2.0 --soft-ratio-step 0.3 --hard-min 300 --max-output-tokens 8192 --call-timeout-ms 35000 --engine-retry-attempts 3 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300 --log

Local Database (for RAG later)
- docker compose -f docker-compose.db.yml up -d
- Embedding scripts exist; not required for unified summarize work.

Approvals / Escalations
- Network + ADC required for Vertex; scripts auto-load `.env.local`.
- Approve network for CLI runs; optional Studio fallback via `GEMINI_API_KEY`.
- Local DB needs Docker permissions.

Current State & Next Steps
- Done:
  - Unified schema + pacing/backoff.
  - Unified API for L1..Lk; channel prep for chat/doc/email.
- Next:
  - Factor a tiny façade `summarize()` that dispatches on input type.
  - Add `processTagsAndArtifacts()` (merge XML + algorithmic tags) as optional post-process.
  - Thin CLI calling unified API.

Files Modified This Session
- src/lib/hmm/unified.ts, src/lib/summarization/xmlEngine.ts, src/lib/hmm/xmlHelpers.ts, README.md.
