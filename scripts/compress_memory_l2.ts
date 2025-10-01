import 'dotenv/config';
import dotenv from 'dotenv';
try { dotenv.config({ path: '.env.local' }); } catch {}
import { promises as fs } from 'fs';
import * as path from 'path';
import { createLogger } from '@/lib/hmm/logger';
import { HierarchicalMemoryCompressor } from '@/lib/hmm/compressor';

type L1Summary = { level: number; covers: number[]; charCount: number; summary: string; summaryChars: number; compressionRatio: number; qualityScore: number; durationMs: number };
type L1File = { slug: string; summaries: L1Summary[] };

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; };

  const slug = getArg('--slug');
  if (!slug) throw new Error('--slug required');
  const groupSize = Number(getArg('--group-size', '5'));
  const l2Multiplier = Math.max(0.5, Number(getArg('--l2-multiplier', '1.5')));
  const l2SoftTarget = Math.max(0.3, Number(getArg('--l2-soft-target', '1.0')));
  const l2Wiggle = Number(getArg('--l2-wiggle', '0.2'));
  const hardMin = Number(getArg('--hard-min', '300'));
  const callTimeoutMs = Number(getArg('--call-timeout-ms', '40000'));
  const maxOutputTokens = Number(getArg('--max-output-tokens', '8192'));
  const useVertex = (getArg('--vertexai', 'true') || 'true').toLowerCase() === 'true';
  const model = getArg('--model', process.env.VERTEX_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash')!;
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';
  const groupsConcurrency = Math.max(1, Number(getArg('--concurrency', '3')));
  const allowHeuristicFallback = (getArg('--allow-heuristic-fallback', 'false') || 'false').toLowerCase() === 'true';
  const overflowMode = (getArg('--overflow-mode', 'accept') || 'accept').toLowerCase() as 'accept' | 'regenerate';
  const overflowMaxRatio = Number(getArg('--overflow-max-ratio', '2.0'));
  const softRatioStep = Number(getArg('--soft-ratio-step', '0.3'));
  const testMode = ((getArg('--test', 'false') || 'false') as string).toLowerCase() === 'true';
  const maxGroups = Number(getArg('--max-groups', testMode ? '1' : '0'));
  const logPath = getArg('--log');
  const logger = await createLogger('compress_l2', logPath);

  const l1Path = path.resolve(process.cwd(), 'artefacts/HMM/compressed', `${slug}.l1.json`);
  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/compressed');
  await fs.mkdir(outDir, { recursive: true });
  const raw = await fs.readFile(l1Path, 'utf8');
  const l1 = JSON.parse(raw) as L1File;
  if (!l1.summaries?.length) throw new Error('No L1 summaries found');

  const compressor = new HierarchicalMemoryCompressor();
  let groups = compressor.groupL1(l1.summaries as any, groupSize) as any[];
  if (maxGroups > 0) groups = groups.slice(0, Math.max(1, Math.floor(maxGroups)));

  const engine = {
    useVertex, project, location, model, callTimeoutMs, maxOutputTokens,
    l2Multiplier, l2Wiggle, hardMin, l2SoftTarget,
    overflowMode, overflowMaxRatio, softRatioStep,
    allowHeuristicFallback,
  } as const;
  logger.info(`Starting L2: groups=${groups.length} groupSize=${groupSize} concurrency=${groupsConcurrency} vertex=${useVertex} model=${model} timeoutMs=${callTimeoutMs}`);
  const results = await compressor.summarizeL2Groups(groups as any, engine as any, groupsConcurrency, logger);

  const out = { slug, produced: results.length, summaries: results };
  const outPath = path.join(outDir, `${slug}.l2.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Export L2: ${outPath} (count=${results.length})`);
  await logger.close();
}

main().catch(err => { console.error(err); process.exit(1); });
