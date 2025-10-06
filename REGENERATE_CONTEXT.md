Regenerate Context — LR Hierarchical Memory Manager (Oct 2025)

Quick handoff to resume the work smoothly.

Where To Look First
- Unified core: `src/lib/hmm/unified.ts` (L1/Lk summarize, ratio‑only, batching with global index remap; chat/document/email prep).
- XML engine: `src/lib/summarization/xmlEngine.ts` (schema `<lN>`, signals/extras; prompt refactor; pacing/backoff; debug prompts).
- XML helpers: `src/lib/hmm/xmlHelpers.ts` (tags/entities incl. `others`, extras).
- RAG: `scripts/rag_answer.ts` (filters, planner JSON, drill covers‑only, rerank stage1+MMR, compose + export prompt with latest.txt).
- DB sync: `scripts/schema_codegen.ts` (ensures `messages.idx`, `summaries.range_*`), `scripts/db_sync.ts` (ensure/upsert/embed; aligns ranges from covers/messages).

Status
- ChatGPT export parsed & ingested (roles filtered). L1/L2/L3 regenerated (ratio‑only 0.10; L2/L3 group‑chars 10k). DB ensured; embeddings OK.
- RAG Answer works; `--export-prompt` writes prompt_<ts>.txt + latest.txt.

Runbook (short)
- Parse + DB: `npm run parse:gpt -- --list ...` then `--index N --db true`.
- L1: ratio‑only 0.10; concurrency 20; batch‑delay 1500ms; Vertex `gemini-2.5-flash`.
- L2/L3: `--group-chars 10000`, ratio‑only 0.10.
- DB ensure/upsert: `npx tsx scripts/schema_codegen.ts --dim 768 && npm run db:ensure && npm run db:upsert -- --in artefacts/...l*.v2.json`.
- Embeddings: `npm run db:embed -- --slug <slug> --vertexai true --embed-model text-embedding-004 --where-level <n>`.
- RAG: `npm run rag:answer -- --slug <slug> --compose-prompt --export-prompt` or `--plan artefacts/plans/synthesis_small.json`.

Next Steps
- Include `quotes` in composed prompt; add auto timeWindow expansion if saturation low; add metrics (mean sim, diversity, coverage, costs).
