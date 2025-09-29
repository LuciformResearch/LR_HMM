const fs = require('fs').promises;
const path = require('path');

async function walk(dir, matcher, out = []) {
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

function parseDirName(dirName) {
  const m = dirName.match(/^(\d{4}-\d{2}-\d{2})__(.+)$/);
  if (!m) {
    return { date: null, title: dirName.replace(/_/g, ' ') };
  }
  const [, date, rawTitle] = m;
  const title = rawTitle.replace(/_/g, ' ');
  return { date, title };
}

async function getConversationInfo(filePath) {
  const dir = path.basename(path.dirname(filePath));
  const { date, title } = parseDirName(dir);
  const content = await fs.readFile(filePath, 'utf8');
  const charCount = Array.from(content).length; // Unicode code points
  const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  return { date, title, dirName: dir, filePath, charCount, lineCount };
}

function formatNumber(n) {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function printTable(items) {
  const headers = ['#', 'Date', 'Titre', 'Caractères', 'Lignes', 'Dossier'];
  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.date ?? '—',
    it.title,
    formatNumber(it.charCount),
    formatNumber(it.lineCount),
    it.dirName,
  ]);
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const pad = (s, w) => ' ' + s.padEnd(w) + ' ';
  const line = cols => '|' + cols.map((c, i) => pad(String(c), colWidths[i])).join('|') + '|';

  console.log(sep);
  console.log(line(headers));
  console.log(sep);
  for (const r of rows) console.log(line(r));
  console.log(sep);
}

async function main() {
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
  infos.sort((a, b) => {
    if (b.charCount !== a.charCount) return b.charCount - a.charCount;
    if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
    return String(b.date ?? '').localeCompare(String(a.date ?? ''));
  });
  printTable(infos);
  const totalChars = infos.reduce((acc, x) => acc + x.charCount, 0);
  const totalLines = infos.reduce((acc, x) => acc + x.lineCount, 0);
  console.log(`\nTotal conversations: ${infos.length}`);
  console.log(`Total caractères: ${formatNumber(totalChars)}`);
  console.log(`Total lignes: ${formatNumber(totalLines)}`);
  const top = infos[0];
  console.log(`\nTop 1 (plus longue): ${top.date ?? '—'} — ${top.title} (${formatNumber(top.charCount)} chars, ${formatNumber(top.lineCount)} lignes)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

