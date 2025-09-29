import * as crypto from 'crypto';

export type ParsedMsg = {
  index: number;
  content: string;
  lineStart?: number; // 1-based absolute line start in source file
  lineEnd?: number;   // 1-based absolute line end in source file
};

export type L1Artifact =
  | { type: 'code_block'; lang: string | null; hash: string; messageIndices: number[]; lineRanges: Array<[number, number]> }
  | { type: 'file_path'; value: string; messageIndices: number[]; lineRanges: Array<[number, number]> }
  | { type: 'command'; value: string; messageIndices: number[]; lineRanges: Array<[number, number]> }
  | { type: 'url'; value: string; messageIndices: number[]; lineRanges: Array<[number, number]> };

const FILE_EXT = ['ts','tsx','js','jsx','py','md','sql','json','yml','yaml','sh','toml','env','txt','tsconfig','eslintrc','prettierrc'];

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}+/gu, '');
}

function tokenizeWords(text: string): string[] {
  // keep unicode letters/digits and - _ .
  return Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_\-]{0,}/gu)).map(m => m[0]);
}

const STOPWORDS_FR = new Set<string>([
  'le','la','les','de','des','du','un','une','et','ou','au','aux','dans','en','avec','sur','sous','pour','par','à','a','est','sont','ce','ces','cette','que','qui','quoi','quand','où','comment','ça','plus','moins','très','tres','ne','pas','on','nous','vous','ils','elles','je','tu','il','elle','y','d\'','l\'','un\'','aujourd\'hui','encore','ainsi','donc','comme','mais','car','or','ni','si','deux','trois','entre','chez','vers','sans','été','etre','être','fait','faites','faites','peu','bien','bon','bonne','oui','non','ok','okay','chaque'
]);

function isLikelyIdentifier(tok: string): boolean {
  return /[A-Za-z_][\w\-]{2,}/.test(tok);
}

function scoreTokens(unigrams: Map<string, number>, originals: string[]): Array<{tag:string; score:number}> {
  const results: Array<{tag:string; score:number}> = [];
  for (const [tok, freq] of unigrams.entries()) {
    let score = freq;
    if (isLikelyIdentifier(tok)) score += 0.5;
    // boost if appears TitleCase in originals
    const titleHit = originals.some(o => o === tok || o === tok[0]?.toUpperCase() + tok.slice(1));
    if (titleHit) score += 0.2;
    results.push({ tag: tok, score });
  }
  results.sort((a,b) => b.score - a.score);
  return results;
}

function buildBigrams(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i+1];
    if (!a || !b) continue;
    const big = `${a} ${b}`;
    map.set(big, (map.get(big) || 0) + 1);
  }
  return map;
}

function dedupKeepTop(cands: Array<{tag:string; score:number}>, maxK: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    if (out.length >= maxK) break;
    const key = c.tag.toLowerCase();
    if (seen.has(key)) continue;
    // avoid keeping unigram if a selected bigram contains it (simple check)
    if (key.indexOf(' ') === -1 && out.some(t => t.includes(key))) continue;
    out.push(c.tag);
    seen.add(key);
  }
  return out;
}

export function extractAlgorithmicTags(messages: ParsedMsg[], minK = 3, maxK = 8): string[] {
  const raw = messages.map(m => m.content).join('\n');
  const rawLower = raw.toLowerCase();
  const tokensOrig = tokenizeWords(raw);
  const tokens = tokenizeWords(stripDiacritics(rawLower))
    .filter(t => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS_FR.has(t));
  const uni = new Map<string, number>();
  for (const t of tokens) uni.set(t, (uni.get(t) || 0) + 1);
  const bi = buildBigrams(tokens);
  const scoredUni = scoreTokens(uni, tokensOrig);
  const scoredBi = Array.from(bi.entries()).map(([tag, freq]) => ({ tag, score: freq + 0.8 }));
  const merged = [...scoredBi, ...scoredUni];
  merged.sort((a,b) => b.score - a.score);
  const top = dedupKeepTop(merged, Math.max(minK, maxK));
  return top.slice(0, Math.max(minK, Math.min(maxK, top.length)));
}

function addLineRanges(matches: Array<{value:string; start:number; end:number}>, baseLine: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of matches) {
    const pre = m.start;
    const within = m.value;
    const startLine = baseLine + (within ? 0 : 0) + (pre === 0 ? 0 : (within.match(/^/g) ? 0 : 0));
    // Fallback simple: compute by counting newlines before and inside
    const beforeText = '';
    // We don't have the whole message prefix content here, so compute relative range by counting newlines in the slice value only.
    const linesInBlock = within.split(/\n/).length - 1;
    const s = baseLine + 0; // best effort
    const e = s + linesInBlock;
    ranges.push([s, e]);
  }
  return ranges;
}

function findAllIndexes(hay: string, re: RegExp): Array<{value:string; start:number; end:number}> {
  const out: Array<{value:string; start:number; end:number}> = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(hay))) {
    out.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function extractArtifacts(messages: ParsedMsg[]): L1Artifact[] {
  const artifacts: L1Artifact[] = [];
  // Per-message extraction to compute approximate absolute line ranges
  for (const m of messages) {
    const content = m.content;
    const baseLine = (m.lineStart ?? 1);
    // code blocks ```lang\n...```
    const codeRe = /```\s*([A-Za-z0-9_\-]+)?\s*\n([\s\S]*?)```/g;
    let cm: RegExpExecArray | null;
    while ((cm = codeRe.exec(content))) {
      const lang = (cm[1] || '').trim() || null;
      const body = cm[2] || '';
      const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0,12);
      const pre = content.slice(0, cm.index);
      const preLines = pre.split(/\n/).length - 1;
      const bodyLines = body.split(/\n/).length - 1;
      const start = baseLine + preLines + 1;
      const end = start + Math.max(0, bodyLines);
      artifacts.push({ type: 'code_block', lang, hash, messageIndices: [m.index], lineRanges: [[start, end]] });
    }

    // file paths (avoid URLs)
    const fileRe = new RegExp(String.raw`(?:^|\s)([A-Za-z0-9_./\-]+\.(?:${FILE_EXT.join('|')}))\b`, 'g');
    for (const fm of findAllIndexes(content, fileRe)) {
      const val = fm.value.trim();
      if (/https?:\/\//i.test(val)) continue;
      const segBefore = content.slice(0, fm.start);
      const delta = segBefore.split(/\n/).length - 1;
      const line = baseLine + delta + 1;
      artifacts.push({ type: 'file_path', value: val, messageIndices: [m.index], lineRanges: [[line, line]] });
    }

    // commands
    const lines = content.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*\$\s+/.test(ln) || /\b(npm|npx|pnpm|yarn|git|docker|curl|psql|node|tsx)\b/.test(ln)) {
        artifacts.push({ type: 'command', value: ln.trim(), messageIndices: [m.index], lineRanges: [[baseLine + i, baseLine + i]] });
      }
    }

    // urls
    const urlRe = /(https?:\/\/[^\s)\]}]+)/g;
    for (const um of findAllIndexes(content, urlRe)) {
      const segBefore = content.slice(0, um.start);
      const delta = segBefore.split(/\n/).length - 1;
      const line = baseLine + delta + 1;
      artifacts.push({ type: 'url', value: um.value, messageIndices: [m.index], lineRanges: [[line, line]] });
    }
  }

  // Merge artifacts with identical signature/value across messages by concatenating ranges/indices
  function sig(a: L1Artifact): string {
    if (a.type === 'code_block') return `${a.type}:${a.lang}:${a.hash}`;
    return `${a.type}:${(a as any).value}`;
  }
  const bySig = new Map<string, L1Artifact>();
  for (const a of artifacts) {
    const k = sig(a);
    if (!bySig.has(k)) {
      bySig.set(k, { ...a, messageIndices: [...a.messageIndices], lineRanges: [...a.lineRanges] } as any);
    } else {
      const cur = bySig.get(k)! as any;
      cur.messageIndices.push(...a.messageIndices);
      cur.lineRanges.push(...a.lineRanges);
    }
  }
  return Array.from(bySig.values());
}
