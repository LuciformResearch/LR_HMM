import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';

function getArg(args: string[], name: string, def?: string) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
}

async function fileExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function main() {
  const args = process.argv.slice(2);
  const slug = getArg(args, '--slug');
  const inPathArg = getArg(args, '--in');
  const outPathArg = getArg(args, '--out');
  const inPlace = (getArg(args, '--in-place', 'false') || 'false').toLowerCase() === 'true';
  const force = (getArg(args, '--force', 'false') || 'false').toLowerCase() === 'true';
  const dryRun = (getArg(args, '--dry-run', 'false') || 'false').toLowerCase() === 'true';

  let inPath = inPathArg || '';
  if (!inPath) {
    if (!slug) throw new Error('Provide --in <file> or --slug <slug>');
    // Try v2 path first, then legacy .l1.json
    const p1 = path.resolve(process.cwd(), 'artefacts/HMM/compressed', `${slug}.l1.v2.json`);
    const p2 = path.resolve(process.cwd(), 'artefacts/HMM/compressed', `${slug}.l1.json`);
    inPath = (await fileExists(p1)) ? p1 : p2;
  }
  if (!(await fileExists(inPath))) throw new Error(`Input file not found: ${inPath}`);

  const raw = await fs.readFile(inPath, 'utf8');
  const json = JSON.parse(raw);
  const summaries = Array.isArray(json?.summaries) ? json.summaries : null;
  if (!summaries) throw new Error('Input JSON has no .summaries array');

  let patched = 0;
  let updated = 0;
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i] || {};
    if (typeof s.index !== 'number') {
      s.index = i;
      patched++;
    } else if (force && s.index !== i) {
      s.index = i;
      updated++;
    }
    summaries[i] = s;
  }

  if (dryRun) {
    console.log(JSON.stringify({ file: inPath, total: summaries.length, patched, updated, mode: 'dry-run' }, null, 2));
    return;
  }

  const outPath = inPlace || !outPathArg
    ? inPath
    : path.resolve(process.cwd(), outPathArg!);

  if (outPath === inPath && !dryRun) {
    // Write in place with small backup
    const bak = `${inPath}.bak`; 
    try { await fs.copyFile(inPath, bak); } catch {}
  }

  json.summaries = summaries;
  await fs.writeFile(outPath, JSON.stringify(json, null, 2), 'utf8');
  console.log(`Patched ${patched} missing index${patched!==1?'es':''}, updated ${updated} existing index${updated!==1?'es':''}. Written: ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

