import 'dotenv/config';
import dotenv from 'dotenv';
try { dotenv.config({ path: '.env.local' }); } catch {}
import { promises as fs } from 'fs';
import * as path from 'path';
import { HierarchicalMemoryCompressor } from '@/lib/hmm/compressor';

type ParsedItem = {
  index: number;
  timestamp: string | null;
  role: 'user' | 'assistant' | 'unknown';
  content: string;
  charCount: number;
  lineStart?: number;
  lineEnd?: number;
};

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; };

  const slug = getArg('--slug', '2025-06-25__orage_codé_textuel')!;
  let windowChars = Number(getArg('--window-chars', '4000'));
  const ensureAssistant = (getArg('--ensure-assistant', 'true') || 'true').toLowerCase() === 'true';
  const maxL1Arg = getArg('--max-l1');
  const maxL1 = maxL1Arg ? Number(maxL1Arg) : Infinity;
  const interlocutor = getArg('--user', 'Lucie')!;
  const structured = (getArg('--structured', 'true') || 'true').toLowerCase() === 'true';
  const structuredXml = (getArg('--structured-xml', 'false') || 'false').toLowerCase() === 'true';
  const profile = (getArg('--profile', 'chat_assistant_fp') || 'chat_assistant_fp') as any;
  const personaName = getArg('--persona-name', 'ShadeOS')!;
  const roleMapArg = getArg('--role-map', 'assistant=ShadeOS,user=Lucie')!;
  const roleMap: Record<string, string> = {};
  for (const kv of roleMapArg.split(',').map(s => s.trim()).filter(Boolean)) { const m = kv.split('='); if (m.length === 2) roleMap[m[0]] = m[1]; }
  const modelOverride = getArg('--model');
  const concurrency = Math.max(1, Number(getArg('--concurrency', '3')));
  const maxSummary = Number(getArg('--max-summary', '400'));
  const targetRatioArg = getArg('--target-ratio');
  const targetRatio = targetRatioArg ? Math.max(0.05, Math.min(0.9, Number(targetRatioArg))) : undefined;
  const timeoutMs = Number(getArg('--timeout-ms', process.env.GEMINI_TIMEOUT_MS || '30000'));
  const useVertex = (getArg('--vertexai', 'false') || 'false').toLowerCase() === 'true';
  const minSummary = Number(getArg('--min-summary', '0'));
  const shortMode = (getArg('--short-mode', 'regenerate') || 'regenerate').toLowerCase() as 'accept' | 'regenerate' | 'error';
  const maxOutputTokens = Number(getArg('--max-output-tokens', '512'));
  const allowHeuristicFallback = (getArg('--allow-heuristic-fallback', 'true') || 'true').toLowerCase() === 'true';
  // xmlEngine pacing/backoff
  const enginePaceMs = Number(getArg('--engine-pace-ms', '0')); // e.g., 3000
  const engineRetryAttempts = Number(getArg('--engine-retry-attempts', '2'));
  const engineRetryBaseMs = Number(getArg('--engine-retry-base-ms', '500'));
  const engineRetryJitterMs = Number(getArg('--engine-retry-jitter-ms', '250'));
  const onlyIndicesArg = getArg('--only-indices');
  const onlyIndices: number[] | undefined = onlyIndicesArg ? (() => {
    const out: number[] = [];
    for (const part of (onlyIndicesArg || '').split(',').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)-(\d+)$/);
      if (m) { const a = Number(m[1]); const b = Number(m[2]); if (!Number.isNaN(a) && !Number.isNaN(b)) { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i <= hi; i++) out.push(i); } }
      else { const v = Number(part); if (!Number.isNaN(v)) out.push(v); }
    }
    return Array.from(new Set(out)).sort((a,b)=>a-b);
  })() : undefined;

  if (modelOverride) {
    const cleaned = modelOverride.startsWith('models/') ? modelOverride.slice(7) : modelOverride;
    process.env.GEMINI_MODEL = cleaned;
    console.log(`Using model override: ${cleaned}`);
  }
  process.env.GEMINI_TIMEOUT_MS = String(timeoutMs);

  const inPathArg = getArg('--in');
  const parsedPath = inPathArg ? path.resolve(process.cwd(), inPathArg) : path.resolve(process.cwd(), 'artefacts/HMM/parsed', `${slug}.json`);
  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/compressed');
  await fs.mkdir(outDir, { recursive: true });

  const raw = await fs.readFile(parsedPath, 'utf8');
  const parsed = JSON.parse(raw) as { items: ParsedItem[]; totals: any };
  const items = parsed.items;

  // Build windows via library
  const compressor = new HierarchicalMemoryCompressor();
  const blocks = await compressor.windowL1(items as any, { windowChars, ensureAssistant, maxL1: Number.isFinite(maxL1) ? Number(maxL1) : Infinity, targetRatio: targetRatio as any });

  // Configure engine
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const l1EngineOpts = {
    useVertex, project, location, model: modelName,
    callTimeoutMs: timeoutMs, maxOutputTokens,
    minSummary, maxSummary, targetRatio,
    structuredXml, allowHeuristicFallback,
    profile, personaName, interlocutor, roleMap,
    shortMode,
    paceDelayMs: enginePaceMs,
    retryAttempts: engineRetryAttempts,
    retryBaseMs: engineRetryBaseMs,
    retryJitterMs: engineRetryJitterMs,
  } as any;

  const summaries: any[] = new Array(blocks.length);

  // Lucie: Je veux ce summarize in batches en option coté runPool, ou coté compressor à toi de voir, avec le parametre batch delay ms.
  // Optional pacing: use concurrency as chunk size; sleep between chunks
  const batchDelayMs = Number(getArg('--batch-delay-ms', '0'));
  async function summarizeInBatches(targetBlocks: { items: ParsedItem[]; charCount: number }[], idxOffset = 0) {
    for (let start = 0; start < targetBlocks.length; start += concurrency) {
      const end = Math.min(start + concurrency, targetBlocks.length);
      const chunk = targetBlocks.slice(start, end);
      const results = await compressor.summarizeL1Blocks(chunk as any, l1EngineOpts, concurrency);
      for (let i = 0; i < results.length; i++) summaries[start + i + idxOffset] = results[i];
      if (end < targetBlocks.length && batchDelayMs > 0) await new Promise(res => setTimeout(res, batchDelayMs));
    }
  }

  // Lucie: Je veux onlyIndices coté compressor aussi, qu'il puisse servir aussi bien aux l1 qu'aux L2.
  if (onlyIndices && onlyIndices.length > 0) {
    const outPath = path.join(outDir, `${slug}.l1.json`);
    let prev: any | undefined;
    try { const rawPrev = await fs.readFile(outPath, 'utf8'); prev = JSON.parse(rawPrev); } catch {}
    if (!prev || !Array.isArray(prev.summaries)) {
      throw new Error(`--only-indices requires an existing L1 file at ${outPath}`);
    }
    const prevByCovers = new Map<string, any>();
    for (let i = 0; i < prev.summaries.length; i++) {
      const s = prev.summaries[i];
      const key = JSON.stringify((s && s.covers) || []);
      if (!prevByCovers.has(key)) prevByCovers.set(key, s);
    }
    for (let i = 0; i < blocks.length; i++) {
      const covers = blocks[i].items.map(m => (m as any).index);
      const key = JSON.stringify(covers);
      const existing = prevByCovers.get(key) || prev.summaries[i];
      if (existing) summaries[i] = existing;
    }
    const selected = onlyIndices.filter(i => i >= 0 && i < blocks.length);
    const jobs = selected.map(i => i);
    const selectedBlocks = jobs.map(i => blocks[i]);
    // Summarize selected in chunks of size = concurrency
    for (let start = 0; start < selectedBlocks.length; start += concurrency) {
      const end = Math.min(start + concurrency, selectedBlocks.length);
      const chunk = selectedBlocks.slice(start, end);
      const res = await compressor.summarizeL1Blocks(chunk as any, l1EngineOpts, concurrency);
      for (let i = 0; i < res.length; i++) summaries[jobs[start + i]] = res[i];
      if (end < selectedBlocks.length && batchDelayMs > 0) await new Promise(r => setTimeout(r, batchDelayMs));
    }
    for (let i = 0; i < summaries.length; i++) if (!summaries[i]) throw new Error(`Missing previous summary for block #${i}; rerun without --only-indices or regenerate a larger range.`);
  } else {
    await summarizeInBatches(blocks as any, 0);
  }

  // Optional algorithmic enrichment
  // Lucie: pareil doit etre purement coté compressor ça et servir aux l1 autant que l2.
  if (structured) {
    try {
      const mods = await import('@/lib/extractors/artifacts');
      const extractAlgorithmicTags = mods.extractAlgorithmicTags as (msgs: any[], minK?: number, maxK?: number) => string[];
      const extractArtifacts = mods.extractArtifacts as (msgs: any[]) => any[];
      const blockByCovers = new Map<string, { items: ParsedItem[]; charCount: number }>();
      for (const b of blocks) {
        const key = JSON.stringify((b.items as any[]).map(m => (m as any).index));
        blockByCovers.set(key, b as any);
      }
      for (const s of summaries as any[]) {
        const key = JSON.stringify((s && s.covers) || []);
        const b = blockByCovers.get(key);
        if (!b) continue;
        const parsedMsgs = (b.items as any[]).map(m => ({ index: (m as any).index, content: (m as any).content, lineStart: (m as any).lineStart, lineEnd: (m as any).lineEnd }));
        const algoTags = extractAlgorithmicTags(parsedMsgs, 3, 8) || [];
        const artifacts = extractArtifacts(parsedMsgs) || [];
        const tagSet = new Set<string>();
        for (const t of (s.tags || [])) tagSet.add(String(t).toLowerCase());
        for (const t of algoTags) tagSet.add(String(t).toLowerCase());
        s.tags = Array.from(tagSet).slice(0, 12);
        s.artifacts = artifacts.map((a: any) => a.type === 'code_block'
          ? { type: a.type, lang: a.lang, hash: a.hash, messageIndices: a.messageIndices, lineRanges: a.lineRanges }
          : { type: (a as any).type, value: (a as any).value, messageIndices: (a as any).messageIndices, lineRanges: (a as any).lineRanges }
        );
      }
    } catch (err) {
      console.warn('Structured L1 enrichment failed:', (err as any)?.message || err);
    }
  }

  const out = { slug, windowChars, ensureAssistant, produced: summaries.length, summaries };
  const outPath = path.join(outDir, `${slug}.l1.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Export L1: ${outPath} (count=${summaries.length})`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
