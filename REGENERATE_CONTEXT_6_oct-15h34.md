Regenerate Context — LR Hierarchical Memory Manager (6 Oct, 15:34)

Quick handoff to resume the work smoothly (with security safeguards).

Where To Look First
- MCP server skeleton: `src/mcp/server.ts` (tools: ping, messages.append, rag.answer, summaries.update dirty)
- Incremental summaries: `src/lib/hmm/updateService.ts` (duos L1, prepareGroups L2/L3, dirty selection)
- RAG service: `src/lib/rag/service.ts` (bundle + optional prompt export)
- Embeddings batch: `src/lib/db/embed.ts` (embedMissingSummaries with per-level counts)
- Simulation scripts:
  - `scripts/simulate_incremental_chat.ts` (modes: assistant parsed/ollama/vertex; skip-RAG-until-L1; logs in artefacts/logs; overwrite artefact)
  - `scripts/benchmark_ollama.ts` (latency bench on local Ollama)
  - `scripts/compose_persona_shadeos.ts` (persona from example + references)
- Persona files: `personas/` (Algareth example; ShadeOS generated + references)

Status
- MCP server boots; append, rag.answer, summaries.update (dirty L1/L2/L3) wired.
- Simulation incremental implemented; logs verbose into `artefacts/logs` and artefacts into `artefacts/generated` (overwritten each run).
- Persona ShadeOS generated and cleaned (no backticks); prompt authorizes addressing Lucie in “tu”.
- Ollama verified; bench available; simulation supports Ollama for chat; Vertex used for summaries + RAG.

Runbook (short)
- Ensure DB: `npx tsx scripts/schema_codegen.ts --dim 768 && npm run db:ensure`
- Compose persona: `npm run persona:shadeos`
- Bench Ollama: `npm run bench:ollama -- --model gemma2:2b --rounds 3 --timeout-ms 20000`
- Simulate (parsed assistant, quick L1 validation):
  `npm run simulate:incremental -- --vertexai true --assistant-mode parsed --limit 3`
- Simulate (Ollama chat, 20 tours):
  `npm run simulate:incremental -- --vertexai true --assistant-mode ollama --ollama true --ollama-model gemma2:2b --limit 20 --ollama-timeout-ms 40000`
 - (future) Simulate mixed (1/5 with RAG+Ollama):
   `npm run simulate:incremental -- --assistant-mode mixed --mix-period 5 --skip-rag-until-l1 true`

Logging / Diagnostics
- File: `artefacts/logs/<slug>__sim_shadeos_<ts>.log`
- Contains per-turn:
  - dirty.l1.count, dirty.l2.groups, dirty.l3.groups
  - update.done dt=...ms
  - embed.inserted.total=... perLevel={...} dt=...ms
  - rag.diagnostics={...} dt=...ms OR rag.skipped=noL1
  - chatgen.mode=parsed OR chatgen.model=... useOllama=... dt=...ms len=...
- Prompts (optional): `--export-prompt true` writes `artefacts/HMM/composed_prompt/<slug>/`.

Security Warning (parsed can contain secrets)
- Parsed exports may include scrubbed content that breaks JSON escaping; simulator includes a minimal repair for `sk-REDACTED` artifacts.
- Use `scripts/git_scrub_secrets.sh` for scans if new artefacts are generated.

Notes / Next Tasks (suggested)
- Add `--assistant-mode mixed` with `--mix-period N` to interleave parsed replies and Ollama.
- Add `--reset-conv` to drop previous conversation before simulation.
- Enrich logs with DB IDs upserted and prompt sizes.
- Wire MCP `summaries.update` to a queue for background L2/L3.

Escalations You Can Ask For
- Network access to Vertex/Gemini/Ollama endpoints for live runs.
- DB reset for test conversations.
- Persona edits (regenerate ShadeOS via `scripts/compose_persona_shadeos.ts`).
