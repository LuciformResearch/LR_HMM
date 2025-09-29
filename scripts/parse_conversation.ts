import { promises as fs } from 'fs';
import * as path from 'path';
import 'dotenv/config';

type ParsedMessage = {
  index: number;
  timestamp: string | null;
  role: 'user' | 'assistant' | 'unknown';
  content: string;
  lineStart: number;
  lineEnd: number;
  charCount: number;
};

function findAllConversationFiles(baseDir: string): Promise<string[]> {
  async function walk(dir: string, out: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, out);
      else if (entry.isFile() && entry.name === 'conversation.md') out.push(full);
    }
    return out;
  }
  return walk(baseDir);
}

function parseHeader(line: string): { ts: string | null; role: 'user' | 'assistant' | 'unknown' } | null {
  // Examples:
  // [22:34:04] 🕯️ user :
  // [22:34:06] ⛧ assistant :
  // Allow variable emoji/name between timestamp and role
  const m = line.match(/^\s*\[(\d{2}:\d{2}:\d{2})\]\s+.*?\b(user|assistant)\b\s*:/i);
  if (!m) return null;
  return { ts: m[1], role: m[2].toLowerCase() as any };
}

function parseConversation(content: string): ParsedMessage[] {
  const lines = content.split(/\r?\n/);
  const messages: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;

  const pushCurrent = (endLineIdx: number) => {
    if (!current) return;
    current.lineEnd = endLineIdx;
    current.content = current.content.replace(/^[\n\r]+|[\n\r]+$/g, '');
    current.charCount = Array.from(current.content).length;
    messages.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const header = parseHeader(ln);
    if (header) {
      // finalize previous
      if (current) pushCurrent(i - 1);
      current = {
        index: messages.length,
        timestamp: header.ts,
        role: header.role,
        content: '',
        lineStart: i + 1,
        lineEnd: i + 1,
        charCount: 0,
      };
      continue;
    }
    if (current) {
      current.content += (current.content ? '\n' : '') + ln;
    }
  }
  if (current) pushCurrent(lines.length);

  return messages;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };

  const slug = getArg('--slug', '2025-06-25__orage_codé_textuel');
  const baseDir = path.resolve(process.cwd(), 'ShadeOS_ExtractedData');
  await fs.access(baseDir);

  const files = await findAllConversationFiles(baseDir);
  const target = files.find(f => path.basename(path.dirname(f)) === slug);
  if (!target) {
    throw new Error(`Conversation not found for slug: ${slug}`);
  }

  const raw = await fs.readFile(target, 'utf8');
  const parsed = parseConversation(raw);

  const totals = {
    slug,
    filePath: target,
    messages: parsed.length,
    assistant: parsed.filter(m => m.role === 'assistant').length,
    user: parsed.filter(m => m.role === 'user').length,
    characters: parsed.reduce((a, m) => a + m.charCount, 0),
    lines: raw.split(/\r?\n/).length,
  };

  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/parsed');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${slug}.json`);
  await fs.writeFile(outPath, JSON.stringify({ totals, items: parsed }, null, 2), 'utf8');

  console.log(`Parsed ${slug}: ${totals.messages} messages (${totals.assistant} assistant, ${totals.user} user)`);
  console.log(`Export JSON: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
