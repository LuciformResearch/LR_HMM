import 'dotenv/config';
import dotenv from 'dotenv';
try { dotenv.config({ path: '.env.local' }); } catch {}
import { promises as fs } from 'fs';
import * as path from 'path';

import {
  summarize,
  summarizeBatched,
  prepareBlocksChat,
  type LengthPolicies,
  type LSummary,
  type RawDataBlock,
} from '@/lib/hmm/unified';

type ParsedItem = {
  index: number;
  timestamp: string | null;
  role: 'user' | 'assistant' | 'unknown';
  content: string;
  charCount: number;
};

function getArg(args: string[], name: string, def?: string) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

async function main() {
  const args = process.argv.slice(2);

  const slug = getArg(args, '--slug', '2025-06-25__orage_codé_textuel')!;
  const level = Math.max(1, Number(getArg(args, '--level', '1')));
  const inPathArg = getArg(args, '--in');
  const parsedPath = inPathArg
    ? path.resolve(process.cwd(), inPathArg)
    : path.resolve(process.cwd(), 'artefacts/HMM/parsed', `${slug}.json`);
  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/compressed');
  await fs.mkdir(outDir, { recursive: true });
  const logsDir = path.resolve(process.cwd(), 'artefacts/logs');
  await fs.mkdir(logsDir, { recursive: true });

  // Windowing / prep
  const windowChars = Number(getArg(args, '--window-chars', '4000'));
  const ensureAssistant = (getArg(args, '--ensure-assistant', 'true') || 'true').toLowerCase() === 'true';
  const maxBlocksArg = getArg(args, '--max-l1');
  const maxBlocks = maxBlocksArg ? Number(maxBlocksArg) : Infinity;
  const interlocutor = getArg(args, '--user', 'Lucie')!;
  const profile = (getArg(args, '--profile', 'chat_assistant_fp') || 'chat_assistant_fp') as any;
  const personaName = getArg(args, '--persona-name', 'ShadeOS')!;
  const roleMapArg = getArg(args, '--role-map', 'assistant=ShadeOS,user=Lucie')!;
  const roleMap: Record<string, string> = {};
  for (const kv of roleMapArg.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = kv.split('='); if (m.length === 2) roleMap[m[0]] = m[1];
  }

  // Engine
  const useVertex = (getArg(args, '--vertexai', 'false') || 'false').toLowerCase() === 'true';
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';
  const model = (getArg(args, '--model', process.env.GEMINI_MODEL || 'gemini-2.5-flash') || 'gemini-2.5-flash');
  const callTimeoutMs = Number(getArg(args, '--timeout-ms', process.env.GEMINI_TIMEOUT_MS || '30000'));
  const maxOutputTokens = Number(getArg(args, '--max-output-tokens', '1024'));
  const allowHeuristicFallback = (getArg(args, '--allow-heuristic-fallback', 'true') || 'true').toLowerCase() === 'true';
  const generateSignals = (getArg(args, '--generate-signals', 'true') || 'true').toLowerCase() === 'true';
  const generateExtras = (getArg(args, '--generate-extras', 'true') || 'true').toLowerCase() === 'true';
  const paceDelayMs = Number(getArg(args, '--engine-pace-ms', '0'));
  const retryAttempts = Number(getArg(args, '--engine-retry-attempts', '2'));
  const retryBaseMs = Number(getArg(args, '--engine-retry-base-ms', '500'));
  const retryJitterMs = Number(getArg(args, '--engine-retry-jitter-ms', '250'));
  const wantLog = (getArg(args, '--log', 'true') || 'true').toLowerCase() === 'true';
  const defaultLogName = `${slug}.${new Date().toISOString().replace(/[:]/g,'_')}.run.log`;
  const logFile = getArg(args, '--log-file', path.join(logsDir, defaultLogName))!;

  // Length policies
  const minSummary = Number(getArg(args, '--min-summary', '250'));
  const maxSummary = Number(getArg(args, '--max-summary', '400'));
  const targetRatioArg = getArg(args, '--target-ratio');
  const compressionLevel = targetRatioArg
    ? clamp(Number(targetRatioArg || '0.3'), 0.05, 3.0)
    : clamp(maxSummary / Math.max(1, windowChars), 0.05, 3.0);
  const wiggle = Number(getArg(args, '--wiggle', '0.2'));
  const underflowMode = (getArg(args, '--short-mode', 'regenerate') || 'regenerate') as any; // accept|regenerate|error
  const overflowMode = (getArg(args, '--overflow-mode', 'regenerate') || 'regenerate') as any; // accept|regenerate|error
  const regenerateRatioStep = Number(getArg(args, '--ratio-step', '0.1'));
  const policies: LengthPolicies = {
    compressionLevel,
    wiggle,
    underflowMode,
    overflowMode,
    regenerateRatioStep,
    summaryLenRange: [minSummary, maxSummary]
  };

  const concurrency = Math.max(1, Number(getArg(args, '--concurrency', '3')));
  const batchDelayMs = Number(getArg(args, '--batch-delay-ms', '0'));
  const groupSize = Math.max(2, Number(getArg(args, '--group-size', '5')));
  const fromL1 = getArg(args, '--from-l1');
  const onlyIndicesArg = getArg(args, '--only-indices');
  const onlyIndices = onlyIndicesArg ? (() => {
    const out: number[] = [];
    for (const part of (onlyIndicesArg || '').split(',').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)-(\d+)$/);
      if (m) { const a = Number(m[1]); const b = Number(m[2]); if (!Number.isNaN(a) && !Number.isNaN(b)) { const lo = Math.min(a, b), hi = Math.max(a, b); for (let i = lo; i <= hi; i++) out.push(i); } }
      else { const v = Number(part); if (!Number.isNaN(v)) out.push(v); }
    }
    return Array.from(new Set(out)).sort((a,b)=>a-b);
  })() : undefined;

  // Read parsed conversation
  const raw = await fs.readFile(parsedPath, 'utf8');
  const parsed = JSON.parse(raw) as { items: ParsedItem[]; totals?: any };
  const items = parsed.items || [];

  // If level==1 → prepare chat blocks from parsed items
  // If level>=2 → load prior L1 summaries as input and group them
  let promptHint: string | undefined = undefined;
  let l1Blocks: RawDataBlock[] = [];
  let lGroups: LSummary[][] = [];
  if (level === 1) {
    const turns = items.map((it, i) => ({
      role: it.role === 'assistant' || it.role === 'user' ? it.role : 'unknown',
      content: it.content,
      index: typeof it.index === 'number' ? it.index : i,
      charCount: typeof it.charCount === 'number' ? it.charCount : it.content.length,
    }));

    const prepared = prepareBlocksChat(turns as any, {
      channel: 'chat',
      windowChars,
      ensureAssistant,
      maxBlocks,
      interlocutor,
      roleMap,
      profile,
      personaName,
      namingPolicy: 'allow_from_input_only',
      allowedNames: [interlocutor, personaName].filter(Boolean) as string[],
    } as any);
    promptHint = prepared.promptHint;
    l1Blocks = prepared.blocks;
    if (Number.isFinite(maxBlocks) && (maxBlocks as number) < l1Blocks.length) {
      l1Blocks = l1Blocks.slice(0, maxBlocks as number);
    }
  } else {
    const defaultL1Path = path.join(outDir, `${slug}.l1.v2.json`);
    const l1Path = fromL1 ? path.resolve(process.cwd(), fromL1) : defaultL1Path;
    const rawL1 = await fs.readFile(l1Path, 'utf8');
    const parsedL1 = JSON.parse(rawL1) as { summaries: LSummary[] };
    const l1 = parsedL1.summaries || [];
    // Group into fixed-size arrays
    for (let i = 0; i < l1.length; i += groupSize) {
      lGroups.push(l1.slice(i, Math.min(i + groupSize, l1.length)));
    }
  }

  // Engine options for unified summarize
  const engine = {
    useVertex, project, location, model,
    maxOutputTokens, callTimeoutMs,
    profile, personaName,
    addressing: 'first_person',
    allowSecondPerson: false,
    namingPolicy: 'allow_from_input_only',
    allowedNames: [interlocutor, personaName].filter(Boolean) as string[],
    allowHeuristicFallback,
    paceDelayMs, retryAttempts, retryBaseMs, retryJitterMs,
    generateSignals, generateExtras,
    log: wantLog, logFile,
  } as any;

  // Optional run header logging
  if (wantLog && logFile) {
    const header = {
      ts: new Date().toISOString(),
      kind: 'run-header',
      slug, level, onlyIndices, groupSize,
      windowChars, ensureAssistant, maxBlocks,
      persona: { profile, personaName, interlocutor, roleMap },
      engine: { useVertex, project, location, model, callTimeoutMs, maxOutputTokens, allowHeuristicFallback, paceDelayMs, retryAttempts, retryBaseMs, retryJitterMs, generateSignals, generateExtras },
      policies: { minSummary, maxSummary, compressionLevel, wiggle, underflowMode, overflowMode, regenerateRatioStep },
      batching: { concurrency, batchDelayMs },
      paths: { parsedPath, outDir, logFile }
    };
    try {
      await fs.appendFile(logFile, `[${header.ts}] [script] runHeader ${JSON.stringify(header)}\n`, 'utf8');
    } catch {}
  }

  // Summarize via library batched façade
  const results: LSummary[] = level === 1
    ? await summarizeBatched(l1Blocks, engine, policies, { concurrency, batchDelayMs, directOutput: false, onlyIndices })
    : await summarizeBatched(lGroups, engine, policies, { concurrency, batchDelayMs, directOutput: false, level, onlyIndices });

  const out = {
    slug,
    meta: {
      profile, personaName, interlocutor,
      windowChars, ensureAssistant, maxBlocks,
      concurrency, batchDelayMs,
      model, location, useVertex,
      minSummary, maxSummary, compressionLevel, wiggle,
      underflowMode, overflowMode,
      generateSignals, generateExtras,
    },
    promptHint,
    summaries: results,
  };

  const outPath = path.join(outDir, `${slug}.l${level}.v2.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Saved ${results.length} L${level} summaries → ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
