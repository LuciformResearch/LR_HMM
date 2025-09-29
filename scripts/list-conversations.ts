import { promises as fs } from 'fs';
import * as path from 'path';

type ConversationInfo = {
  date: string | null;
  title: string;
  dirName: string;
  filePath: string;
  charCount: number;
  lineCount: number;
  messageCount: number;
  assistantCount: number;
  userCount: number;
};

async function walk(dir: string, matcher: (p: string) => boolean, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, matcher, out);
    } else if (entry.isFile()) {
      if (matcher(full)) out.push(full);
    }
  }
  return out;
}

function parseDirName(dirName: string): { date: string | null; title: string } {
  // Expect format: YYYY-MM-DD__title_words
  const m = dirName.match(/^(\d{4}-\d{2}-\d{2})__(.+)$/);
  if (!m) {
    return { date: null, title: dirName.replace(/_/g, ' ') };
  }
  const [, date, rawTitle] = m;
  const title = rawTitle.replace(/_/g, ' ');
  return { date, title };
}

function countMessages(content: string): { total: number; assistant: number; user: number } {
  const lines = content.split(/\r?\n/);
  const headerRe = /^\s*\[\d{2}:\d{2}:\d{2}\]\s+.*?\b(user|assistant)\b\s*:/i;
  let total = 0;
  let assistant = 0;
  let user = 0;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      total += 1;
      const role = m[1].toLowerCase();
      if (role === 'assistant') assistant += 1;
      else if (role === 'user') user += 1;
    }
  }
  return { total, assistant, user };
}

async function getConversationInfo(filePath: string): Promise<ConversationInfo> {
  const dir = path.basename(path.dirname(filePath));
  const { date, title } = parseDirName(dir);
  const content = await fs.readFile(filePath, 'utf8');
  // Count Unicode code points instead of UTF-16 units
  const charCount = Array.from(content).length;
  const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  const { total, assistant, user } = countMessages(content);
  return { date, title, dirName: dir, filePath, charCount, lineCount, messageCount: total, assistantCount: assistant, userCount: user };
}

function formatNumber(n: number): string {
  return n.toLocaleString('fr-FR');
}

function printTable(items: ConversationInfo[]) {
  const headers = ['#', 'Date', 'Titre', 'Caractères', 'Lignes', 'Messages', 'Assistant', 'Utilisateur', 'Dossier'];
  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.date ?? '—',
    it.title,
    formatNumber(it.charCount),
    formatNumber(it.lineCount),
    formatNumber(it.messageCount),
    formatNumber(it.assistantCount),
    formatNumber(it.userCount),
    it.dirName,
  ]);

  // Compute column widths
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const pad = (s: string, w: number) => ' ' + s.padEnd(w) + ' ';

  const line = (cols: string[]) => '|' + cols.map((c, i) => pad(c, colWidths[i])).join('|') + '|';

  console.log(sep);
  console.log(line(headers));
  console.log(sep);
  for (const r of rows) console.log(line(r.map(String)));
  console.log(sep);
}

async function main() {
  // Simple CLI flags: --out <path> --format <json|csv|both>
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };
  const hasFlag = (name: string) => args.includes(name);
  const format = (getArg('--format', 'json') as 'json' | 'csv' | 'both');
  let outPath = getArg('--out');

  const baseDir = path.resolve(process.cwd(), 'ShadeOS_ExtractedData');
  try {
    await fs.access(baseDir);
  } catch {
    console.error(`Base directory not found: ${baseDir}`);
    process.exit(1);
  }

  const files = await walk(baseDir, p => path.basename(p) === 'conversation.md');
  if (files.length === 0) {
    console.error('No conversation.md files found.');
    process.exit(1);
  }

  const infos = await Promise.all(files.map(getConversationInfo));

  // Sort by character count desc, then by line count desc, then by date desc
  infos.sort((a, b) => {
    if (b.charCount !== a.charCount) return b.charCount - a.charCount;
    if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
    return String(b.date ?? '').localeCompare(String(a.date ?? ''));
  });

  printTable(infos);

  // Summary
  const totalChars = infos.reduce((acc, x) => acc + x.charCount, 0);
  const totalLines = infos.reduce((acc, x) => acc + x.lineCount, 0);
  console.log(`\nTotal conversations: ${infos.length}`);
  console.log(`Total caractères: ${formatNumber(totalChars)}`);
  console.log(`Total lignes: ${formatNumber(totalLines)}`);
  console.log(`\nTop 1 (plus longue): ${infos[0].date ?? '—'} — ${infos[0].title} (${formatNumber(infos[0].charCount)} chars, ${formatNumber(infos[0].lineCount)} lignes)`);

  // Export
  const exportDirDefault = path.resolve(process.cwd(), 'artefacts');
  if (!outPath) {
    outPath = path.join(exportDirDefault, 'conversations_metrics.' + (format === 'csv' ? 'csv' : 'json'));
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const metrics = {
    generatedAt: new Date().toISOString(),
    baseDir,
    totals: {
      conversations: infos.length,
      characters: totalChars,
      lines: totalLines,
      messages: infos.reduce((a, x) => a + x.messageCount, 0),
      assistant: infos.reduce((a, x) => a + x.assistantCount, 0),
      user: infos.reduce((a, x) => a + x.userCount, 0),
    },
    top: {
      date: infos[0].date,
      title: infos[0].title,
      dirName: infos[0].dirName,
      filePath: infos[0].filePath,
      charCount: infos[0].charCount,
      lineCount: infos[0].lineCount,
      messageCount: infos[0].messageCount,
      assistantCount: infos[0].assistantCount,
      userCount: infos[0].userCount,
    },
    items: infos,
  };

  function toCSV(items: ConversationInfo[]): string {
    const header = ['date','title','dirName','filePath','charCount','lineCount','messageCount','assistantCount','userCount'];
    const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    const lines = [header.join(',')];
    for (const it of items) {
      lines.push([
        it.date ?? '',
        esc(it.title),
        esc(it.dirName),
        esc(it.filePath),
        String(it.charCount),
        String(it.lineCount),
        String(it.messageCount),
        String(it.assistantCount),
        String(it.userCount),
      ].join(','));
    }
    return lines.join('\n');
  }

  if (format === 'json') {
    await fs.writeFile(outPath, JSON.stringify(metrics, null, 2), 'utf8');
    console.log(`\nExport JSON: ${outPath}`);
  } else if (format === 'csv') {
    const csv = toCSV(infos);
    await fs.writeFile(outPath, csv, 'utf8');
    console.log(`\nExport CSV: ${outPath}`);
  } else {
    // both
    const jsonPath = outPath.endsWith('.json') || outPath.endsWith('.csv') ? outPath.replace(/\.(json|csv)$/,'') : outPath;
    const jp = jsonPath + '.json';
    const cp = jsonPath + '.csv';
    await fs.writeFile(jp, JSON.stringify(metrics, null, 2), 'utf8');
    await fs.writeFile(cp, toCSV(infos), 'utf8');
    console.log(`\nExport JSON: ${jp}`);
    console.log(`Export CSV: ${cp}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
