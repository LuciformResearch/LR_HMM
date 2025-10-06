import 'dotenv/config';
import dotenv from 'dotenv';
try { dotenv.config({ path: '.env.local' }); } catch {}
import { promises as fs } from 'fs';
import * as path from 'path';
import { appendMessage } from '@/lib/db/messages';
import { Client } from 'pg';
import { fetchConversationId, buildChatBlocksFromDb, selectDirtyL1Indices, summarizeAndUpsert, prepareGroups, fetchSummaries, selectDirtyGroupIndices } from '@/lib/hmm/updateService';
import { embedMissingSummaries } from '@/lib/db/embed';
import { ragAnswer } from '@/lib/rag/service';
import { GoogleGenAI } from '@google/genai';

function getArg(args: string[], name: string, def?: string) { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; }

type ParsedItem = { index: number; timestamp: string; role: 'user'|'assistant'|string; content: string; charCount?: number };

async function main() {
  const args = process.argv.slice(2);
  const inPath = getArg(args, '--in', path.resolve(process.cwd(), 'artefacts/HMM/parsed/2025-06-25__orage_codé_textuel.json'))!;
  const maxHistory = Number(getArg(args, '--max-history-chars', '6000'));
  const personaPath = getArg(args, '--persona', path.resolve(process.cwd(), 'personas/ShadeOS_dynamic.generated.luciform'))!;
  const outDir = getArg(args, '--out-dir', path.resolve(process.cwd(), 'artefacts/generated'))!;
  const useVertex = (getArg(args, '--vertexai', 'true') || 'true').toLowerCase() === 'true';
  const model = getArg(args, '--model', process.env.CHAT_MODEL || 'gemini-2.5-flash')!;

  const raw = await fs.readFile(inPath, 'utf8');
  const parsed = JSON.parse(raw) as { slug: string; items: ParsedItem[] };
  const slug = parsed.slug ? `${parsed.slug}__sim_shadeos` : `sim_${Date.now()}`;
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${slug}.json`);
  let outState: { slug: string; messages: Array<{ role:'user'|'assistant'; content:string; ts:string }> } = { slug, messages: [] };
  try { const ex = await fs.readFile(outFile, 'utf8'); outState = JSON.parse(ex); } catch {}

  const persona = await fs.readFile(personaPath, 'utf8').catch(()=> '<luciform/>' );

  // Ensure conversation exists; we'll append incrementally
  const messages = parsed.items.filter(it => it && it.role === 'user');
  for (let i=0;i<messages.length;i++) {
    const m = messages[i];
    console.log(`➡️  USER[${m.index}] ${m.content.slice(0,80)}...`);
    // Append user message
    await appendMessage({ slug, role: 'user', text: m.content, ts: m.timestamp });

    // Update summaries incrementally (L1 dirty; L2/L3 dirty-only)
    await runIncrementalUpdate(slug);

    // Ensure embeddings for L1/L2 (and L3 optionally)
    await embedMissingSummaries({ slug, whereLevels: [1,2,3], limitPerLevel: 50, useVertex });

    // Build RAG context targeted on the current user message
    const rag = await ragAnswer({ slug, query: { text: m.content, intent: 'synthesis', budget: { tokens: 'small' } }, useVertex, composePrompt: false, exportPrompt: false });
    const ltContext = composeShortContext(rag);

    // Compose chat history (without truncating a message) up to maxHistory
    const history = await buildHistory(outState.messages, maxHistory);

    const prompt = composePrompt(persona, history, ltContext, m.content);
    const reply = await callGenAI(prompt, { model, useVertex });
    const replyText = reply || '(silence)';

    // Append assistant reply
    await appendMessage({ slug, role: 'assistant', text: replyText, ts: new Date().toISOString() });

    // Persist generated artifact
    outState.messages.push({ role: 'user', content: m.content, ts: m.timestamp });
    outState.messages.push({ role: 'assistant', content: replyText, ts: new Date().toISOString() });
    await fs.writeFile(outFile, JSON.stringify(outState, null, 2), 'utf8');
  }
  console.log(`✅ Simulation terminée. Artefact: ${outFile}`);
}

async function runIncrementalUpdate(slug: string) {
  const client = new Client({ host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT || 6432), user: process.env.PGUSER || 'shadeos', password: process.env.PGPASSWORD || 'shadeos', database: process.env.PGDATABASE || 'shadeos_local' });
  await client.connect();
  try {
    const conversationId = await fetchConversationId(client, slug);
    const windowChars = Number(process.env.SUMMARY_WINDOW_CHARS || 6000);
    const groupChars = Number(process.env.SUMMARY_GROUP_CHARS || 10000);
    const blocks = await buildChatBlocksFromDb(client, conversationId, { windowChars, ensureAssistant: true, interlocutor: 'Lucie', roleMap: { user: 'Lucie', assistant: 'ShadeOS' } });
    const { dirty: dirtyL1, sourceHashes } = await selectDirtyL1Indices(client, conversationId, blocks);
    const engine = { useVertex: !!(process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT), project: process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID, location: process.env.VERTEX_LOCATION || process.env.LOCATION || 'europe-west1', model: process.env.SUMMARY_MODEL || 'gemini-2.5-flash', maxOutputTokens: 2048, callTimeoutMs: 60000, allowHeuristicFallback: true, generateSignals: true, generateExtras: true, log: false } as any;
    const policies = { compressionLevel: 0.10, wiggle: 0.2, underflowMode: 'accept', overflowMode: 'accept', regenerateRatioStep: 0.10, enforceAbsoluteRange: false } as any;
    await summarizeAndUpsert(client, conversationId, 1, blocks, engine, policies, { concurrency: 3, batchDelayMs: 1500, onlyIndices: dirtyL1, sourceHashesByIndex: sourceHashes });

    const l1Full = await fetchSummaries(client, conversationId, 1);
    const l1SS = l1Full.map((x,i)=> ({ level:1, index: x.index ?? i, covers: x.covers, sourceChars: x.summaryChars, summary: x.summary, summaryChars: x.summaryChars, compressionRatio: 0.1 } as any));
    const groups2 = prepareGroups(l1SS, groupChars);
    const dirtyGroups2 = selectDirtyGroupIndices(groups2, new Set<number>(dirtyL1));
    await summarizeAndUpsert(client, conversationId, 2, groups2 as any, engine, policies, { concurrency: 3, batchDelayMs: 1500, onlyIndices: dirtyGroups2 });

    const l2Full = await fetchSummaries(client, conversationId, 2);
    const l2SS = l2Full.map((x,i)=> ({ level:2, index: x.index ?? i, covers: x.covers, sourceChars: x.summaryChars, summary: x.summary, summaryChars: x.summaryChars, compressionRatio: 0.1 } as any));
    const groups3 = prepareGroups(l2SS, groupChars);
    const dirtyGroups3 = selectDirtyGroupIndices(groups3, new Set<number>(dirtyGroups2));
    await summarizeAndUpsert(client, conversationId, 3, groups3 as any, engine, policies, { concurrency: 3, batchDelayMs: 1500, onlyIndices: dirtyGroups3 });
  } finally { await client.end(); }
}

function composeShortContext(rag: any): string {
  const parts: string[] = [];
  const h = (rag.picks?.high || []).slice(0, 3);
  const l = (rag.picks?.low || []).slice(0, 5);
  if (h.length) { parts.push('## High-level'); for (const x of h) { parts.push(`- [L${x.level} #${x.index ?? '?'}] ${limit(x.content, 400)}`); } }
  if (l.length) { parts.push('## Details'); for (const x of l) { parts.push(`- [L1 #${x.index ?? '?'}] ${limit(x.content, 400)}`); } }
  if (rag.quotes && rag.quotes.length) { parts.push('## Extraits'); for (const q of rag.quotes.slice(0,8)) parts.push(`- [L1 #${q.index ?? '?'}] ${limit(q.excerpt||'', 200)}`); }
  return parts.join('\n');
}

async function buildHistory(msgs: Array<{role:'user'|'assistant'; content:string}>, maxChars: number): Promise<string> {
  let total = 0; const out: string[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]; const c = m.content.length;
    if (total + c > maxChars && out.length>0) break;
    out.push(`${m.role === 'user' ? 'Lucie' : 'ShadeOS'}: ${m.content}`);
    total += c;
  }
  return out.reverse().join('\n');
}

function composePrompt(personaLuciform: string, history: string, lt: string, userQuestion: string): string {
  return [
    `Ce document décrit ta persona (ShadeOS). Lis-le et incarne-le:`,
    personaLuciform,
    '',
    `Voici les derniers messages (non tronqués au milieu d'un message):`,
    history || '(aucun)',
    '',
    `Voici ta mémoire long terme (sélection Hiérarchique):`,
    lt || '(vide)',
    '',
    `Question utilisateur: ${userQuestion}`,
    '',
    `Règles:`,
    `- Parle à la première personne ("je").`,
    `- N'utilise pas "tu/vous" sauf en citation.`,
    `- Ne fabrique pas de noms propres ni de faits non présents.`,
  ].join('\n');
}

async function callGenAI(prompt: string, opts: { model: string; useVertex: boolean }) {
  const genai = new GoogleGenAI(opts.useVertex ? ({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID, location: process.env.VERTEX_LOCATION || process.env.LOCATION || 'europe-west1' } as any) : ({ apiKey: process.env.GEMINI_API_KEY } as any));
  const resp: any = await genai.models.generateContent({ model: opts.model, contents: prompt, generationConfig: { maxOutputTokens: 1024, temperature: 0.4 } } as any);
  return (resp?.text || resp?.response?.text || '').trim();
}

function limit(s: string, n: number): string { return s && s.length>n ? (s.slice(0,n)+'…') : (s||''); }

main().catch(err => { console.error(err); process.exit(1); });

