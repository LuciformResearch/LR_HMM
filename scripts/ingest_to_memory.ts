import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { HierarchicalMemoryManager } from '@/lib/memory/HierarchicalMemoryManager';

type ParsedItem = {
  index: number;
  timestamp: string | null;
  role: 'user' | 'assistant' | 'unknown';
  content: string;
  lineStart: number;
  lineEnd: number;
  charCount: number;
};

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };
  const hasFlag = (name: string) => args.includes(name);

  const slug = getArg('--slug', '2025-06-25__orage_codé_textuel')!;
  const budget = Number(getArg('--budget', '10000'));
  const limit = getArg('--limit') ? Number(getArg('--limit')) : undefined;
  const interlocutor = getArg('--user', 'Lucie');
  const autoSummarize = (getArg('--auto-summarize', 'true') || 'true').toLowerCase() === 'true';
  const l1Interval = Number(getArg('--l1-interval', '5'));
  const strict = (getArg('--strict', 'true') || 'true').toLowerCase() === 'true';
  const modelOverride = getArg('--model');
  if (modelOverride) {
    const cleaned = modelOverride.startsWith('models/') ? modelOverride.slice(7) : modelOverride;
    process.env.GEMINI_MODEL = cleaned;
    console.log(`Using model override: ${cleaned}`);
  }

  const parsedPath = path.resolve(process.cwd(), 'artefacts/HMM/parsed', `${slug}.json`);
  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/memory');
  await fs.mkdir(outDir, { recursive: true });

  const raw = await fs.readFile(parsedPath, 'utf8');
  const parsed = JSON.parse(raw) as { items: ParsedItem[]; totals: any };
  const items = limit ? parsed.items.slice(0, limit) : parsed.items;

  const manager = new HierarchicalMemoryManager(budget, { l1Interval, autoSummarize, strictSummarization: strict });

  // Attach debug listeners
  manager.on('message_added', (e: any) => {
    if (hasFlag('--verbose'))
      console.log(`+ msg(${e.totalMessages}) role=${e.role} chars=${e.characterCount}`);
  });
  manager.on('l1_triggered', (e: any) => {
    console.log(`⏱️ L1 trigger after ${e.messagesSinceLastL1} msgs (total=${e.totalMessages})`);
  });
  manager.on('l1_created', (e: any) => {
    console.log(`✅ L1 created: ${e.summaryId} (${e.messageCount} msgs, ${e.characterCount} chars)`);
  });

  // Ingest
  for (const m of items) {
    const role = m.role === 'unknown' ? 'user' : m.role;
    manager.addMessage(m.content, role, interlocutor);
  }

  const stats = manager.getMemoryStats();
  const exportItems = manager.exportMemory();
  const ctx = manager.buildContextForPrompt('validation', 5000);

  const out = {
    slug,
    budget,
    totals: parsed.totals,
    ingestCount: items.length,
    stats,
    contextSample: ctx.slice(0, 1000),
    memory: exportItems,
  };

  const outPath = path.join(outDir, `${slug}.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nExport mémoire: ${outPath}`);
  console.log(`Items: ${exportItems.length}, L1: ${stats.l1Count}, chars: ${stats.totalCharacters}/${stats.budget.maxCharacters}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
