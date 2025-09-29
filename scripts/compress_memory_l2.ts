import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';
import { LuciformXMLParser } from '@/lib/xml-parser/index';

type Logger = { info: (msg: string) => void; close: () => Promise<void>; dir: string; file: string; base: string };

async function createLogger(prefix: string, logPathArg?: string): Promise<Logger> {
  const fsDyn = await import('fs');
  const pathDyn = await import('path');
  const dir = logPathArg && !logPathArg.endsWith('.log') ? logPathArg : pathDyn.resolve(process.cwd(), 'artefacts/logs');
  await fsDyn.promises.mkdir(dir, { recursive: true });
  const runId = Date.now();
  const file = logPathArg && logPathArg.endsWith('.log') ? logPathArg : pathDyn.join(dir, `${prefix}_${runId}.log`);
  const stream = fsDyn.createWriteStream(file, { flags: 'a' });
  const write = (msg: string) => { const line = `[${new Date().toISOString()}] ${msg}`; console.log(line); stream.write(line + '\n'); };
  write(`Log ouvert: ${file}`);
  const base = file.replace(/\.log$/, '');
  return { info: write, close: async () => new Promise(res => stream.end(res)), dir, file, base };
}

type L1Summary = {
  level: number;
  covers: number[];
  charCount: number;
  summary: string;
  summaryChars: number;
  compressionRatio: number;
  qualityScore: number;
  durationMs: number;
};

type L1File = {
  slug: string;
  summaries: L1Summary[];
};

async function getVertexToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token || !token.token) throw new Error('Failed to obtain Vertex token');
  return token.token;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function generateMetaSummary(items: L1Summary[], opts: { useVertex: boolean; model: string; maxChars: number; minChars: number; callTimeoutMs: number; project?: string; location?: string; apiKey?: string; fallbackModel?: string; logger: Logger; maxOutputTokens: number }): Promise<{ text: string; strategy: 'primary-model' | 'fallback-model' | 'heuristic-none'; } > {
  const text = items.map((s, i) => `L1 #${i+1} (chars=${s.summaryChars}): ${s.summary}`).join('\n\n');
  const baseInstr = `Crée un méta‑résumé en français à partir des résumés L1 ci‑dessous.\nContraintes: entre ${Math.max(100, opts.minChars)} et ${opts.maxChars} caractères, 3 à 5 phrases complètes, conserve les faits, pas d'invention, style clair et neutre.`;
  const mkPrompt = (emphasis: string = '') => `${baseInstr}${emphasis ? '\n' + emphasis : ''}\n\nDocuments:\n${text}\n\nMéta‑résumé:`;
  const attempts = [
    { model: opts.model, prompt: mkPrompt() },
    { model: opts.fallbackModel || opts.model, prompt: mkPrompt(`IMPORTANT: la longueur doit être >= ${opts.minChars} caractères. Si nécessaire, liste 4–6 points clés en phrases complètes.`) }
  ];
  let attemptIndex = 0;
  if (opts.useVertex) {
    const token = await getVertexToken();
    for (const att of attempts) {
      attemptIndex += 1;
      opts.logger.info(`L2 attempt #${attemptIndex} with Vertex model=${att.model}`);
      const url = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.project}/locations/${opts.location}/publishers/google/models/${encodeURIComponent(att.model)}:generateContent`;
      const body = { contents: [{ role: 'user', parts: [{ text: att.prompt }] }], generationConfig: { maxOutputTokens: opts.maxOutputTokens, temperature: 0.3 } };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.callTimeoutMs);
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
        const js: any = await res.json();
        const out = (js?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim();
        // Dump full outputs for debugging
        try {
          const fsDyn = await import('fs'); const pathDyn = await import('path');
          const base = `${opts.logger.base}__attempt${attemptIndex}__${att.model.replace(/[^a-zA-Z0-9_\-\.]/g,'_')}`;
          await fsDyn.promises.writeFile(`${base}__prompt.txt`, att.prompt, 'utf8');
          await fsDyn.promises.writeFile(`${base}__output.txt`, out, 'utf8');
          await fsDyn.promises.writeFile(`${base}__raw.json`, JSON.stringify(js, null, 2), 'utf8');
          opts.logger.info(`L2 attempt #${attemptIndex} dumps written: ${base}__*.{txt,json}`);
        } catch {}
        opts.logger.info(`L2 attempt #${attemptIndex} result length=${out.length} head="${out.slice(0,120).replace(/\s+/g,' ')}"`);
        if (out.length >= opts.minChars) return { text: out.slice(0, opts.maxChars), strategy: att === attempts[0] ? 'primary-model' : 'fallback-model' };
      } finally { clearTimeout(t); }
    }
    return { text: '', strategy: 'heuristic-none' };
  } else {
    const apiKey = opts.apiKey!;
    const genAI = new GoogleGenerativeAI(apiKey);
    for (const att of attempts) {
      attemptIndex += 1;
      opts.logger.info(`L2 attempt #${attemptIndex} with AI Studio model=${att.model}`);
      const model = genAI.getGenerativeModel({ model: att.model });
      const resp: any = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: att.prompt }] }], generationConfig: { maxOutputTokens: opts.maxOutputTokens, temperature: 0.3 } });
      const tfn = resp?.response?.text; const txt = (typeof tfn === 'function' ? resp.response.text() : resp?.response?.text) as string;
      const out = String(txt||'').trim();
      try {
        const fsDyn = await import('fs');
        const base = `${opts.logger.base}__attempt${attemptIndex}__${att.model.replace(/[^a-zA-Z0-9_\-\.]/g,'_')}`;
        await fsDyn.promises.writeFile(`${base}__prompt.txt`, att.prompt, 'utf8');
        await fsDyn.promises.writeFile(`${base}__output.txt`, out, 'utf8');
      } catch {}
      opts.logger.info(`L2 attempt #${attemptIndex} result length=${out.length} head="${out.slice(0,120).replace(/\s+/g,' ')}"`);
      if (out.length >= opts.minChars) return { text: out.slice(0, opts.maxChars), strategy: att === attempts[0] ? 'primary-model' : 'fallback-model' };
    }
    return { text: '', strategy: 'heuristic-none' };
  }
}

// Generate XML-structured L2
async function generateMetaSummaryXML(
  items: L1Summary[],
  opts: { useVertex: boolean; model: string; maxChars: number; minChars: number; callTimeoutMs: number; project?: string; location?: string; apiKey?: string; fallbackModel?: string; logger: Logger; maxOutputTokens: number; hintTarget?: number; hintCap?: number }
): Promise<{ xml: string; strategy: 'primary-model' | 'fallback-model' | 'heuristic-none'; } > {
  const docs = items.map((s, i) => `---\n[L1 #${i+1} | ${s.summaryChars} chars]\n${s.summary}`).join('\n');
  const soft = opts.hintTarget ? `Objectif longueur: ${opts.hintTarget} caractères (cible douce).` : '';
  const cap = opts.hintCap ? `Ne JAMAIS dépasser ${opts.hintCap} caractères (cap dur).` : '';
  const baseInstr = `Tu es un assistant de résumé fiable. Lis les résumés L1 et PRODUIS UNIQUEMENT un XML strict conforme au schéma suivant (aucun texte hors XML):\n\n<l2 minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary><![CDATA[...${opts.minChars}-${opts.maxChars} caractères environ, factuel, sans invention...]]></summary>\n  <tags>\n    <tag>...</tag> <!-- 5 à 12 tags, présents dans les L1 -->\n  </tags>\n  <entities>\n    <persons><p>...</p></persons>\n    <artifacts><a>...</a></artifacts>\n    <places><pl>...</pl></places>\n    <times><t>...</t></times>\n  </entities>\n  <signals><![CDATA[{\\"themes\\":[...],\\"timeline\\":[{\\"t\\":\\"00:12\\",\\"event\\":\\"...\\"}]}]]></signals>\n  <extras>\n    <!-- (Optionnel) Liste les détails importants supprimés par la compression pour audit -->\n    <omission>...</omission>\n  </extras>\n</l2>\n\n${soft} ${cap} Reste STRICTEMENT dans les bornes min/max en nombre de caractères, sans contrainte sur le nombre de phrases.\nSi des détails doivent être omis, liste-les brièvement dans <extras> sans gonfler le <summary>.\nRègle tags: UNIQUEMENT des mots/bi-grammes réellement présents dans les L1.\nRéponds par le XML strict uniquement.`;
  const mkPrompt = (emphasis: string = '') => `${baseInstr}${emphasis ? '\n' + emphasis : ''}\n\nDocuments:\n${docs}`;
  const attempts = [
    { model: opts.model, prompt: mkPrompt() },
    { model: opts.fallbackModel || opts.model, prompt: mkPrompt(`IMPORTANT: le <summary> doit être >= ${opts.minChars} caractères.`) }
  ];
  let attemptIndex = 0;
  if (opts.useVertex) {
    const token = await getVertexToken();
    for (const att of attempts) {
      attemptIndex += 1;
      opts.logger.info(`L2 attempt #${attemptIndex} (XML) with Vertex model=${att.model}`);
      const url = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.project}/locations/${opts.location}/publishers/google/models/${encodeURIComponent(att.model)}:generateContent`;
      const body = { contents: [{ role: 'user', parts: [{ text: att.prompt }] }], generationConfig: { maxOutputTokens: opts.maxOutputTokens, temperature: 0.2 } };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.callTimeoutMs);
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
        const js: any = await res.json();
        const out = (js?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim();
        try {
          const fsDyn = await import('fs');
          const base = `${opts.logger.base}__attempt${attemptIndex}__${att.model.replace(/[^a-zA-Z0-9_\-\.]/g,'_')}`;
          await fsDyn.promises.writeFile(`${base}__prompt.txt`, att.prompt, 'utf8');
          await fsDyn.promises.writeFile(`${base}__output.txt`, out, 'utf8');
          await fsDyn.promises.writeFile(`${base}__raw.json`, JSON.stringify(js, null, 2), 'utf8');
          opts.logger.info(`L2 attempt #${attemptIndex} dumps written: ${base}__*.{txt,json}`);
        } catch {}
        opts.logger.info(`L2 attempt #${attemptIndex} XML chars=${out.length} head="${out.slice(0,120).replace(/\s+/g,' ')}"`);
        if (out.includes('<l2')) return { xml: out, strategy: att === attempts[0] ? 'primary-model' : 'fallback-model' };
      } finally { clearTimeout(t); }
    }
    return { xml: '', strategy: 'heuristic-none' };
  } else {
    const apiKey = opts.apiKey!;
    const genAI = new GoogleGenerativeAI(apiKey);
    for (const att of attempts) {
      attemptIndex += 1;
      opts.logger.info(`L2 attempt #${attemptIndex} (XML) with AI Studio model=${att.model}`);
      const model = genAI.getGenerativeModel({ model: att.model });
      const resp: any = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: att.prompt }] }], generationConfig: { maxOutputTokens: opts.maxOutputTokens, temperature: 0.2 } });
      const tfn = resp?.response?.text; const txt = (typeof tfn === 'function' ? resp.response.text() : resp?.response?.text) as string;
      const out = String(txt||'').trim();
      try {
        const fsDyn = await import('fs');
        const base = `${opts.logger.base}__attempt${attemptIndex}__${att.model.replace(/[^a-zA-Z0-9_\-\.]/g,'_')}`;
        await fsDyn.promises.writeFile(`${base}__prompt.txt`, att.prompt, 'utf8');
        await fsDyn.promises.writeFile(`${base}__output.txt`, out, 'utf8');
      } catch {}
      opts.logger.info(`L2 attempt #${attemptIndex} XML chars=${out.length} head="${out.slice(0,120).replace(/\s+/g,' ')}"`);
      if (out.includes('<l2')) return { xml: out, strategy: att === attempts[0] ? 'primary-model' : 'fallback-model' };
    }
    return { xml: '', strategy: 'heuristic-none' };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; };
  const slug = getArg('--slug');
  if (!slug) throw new Error('--slug required');
  const maxChars = Number(getArg('--max-summary', '1200'));
  const minChars = Number(getArg('--min-summary', '900'));
  const groupSize = Number(getArg('--group-size', '5')); // combine up to N L1 per L2
  const l2Multiplier = Math.max(0.5, Number(getArg('--l2-multiplier', '1.5')));
  const l2SoftTarget = Math.max(0.3, Number(getArg('--l2-soft-target', '1.0')));
  const l2Wiggle = Number(getArg('--l2-wiggle', '0.2')); // ±20% tolerance around target length
  const autoTrim = (getArg('--auto-trim', 'false') || 'false').toLowerCase() === 'true';
  const hardMin = Number(getArg('--hard-min', '300')); // minimal sanity check
  const callTimeoutMs = Number(getArg('--call-timeout-ms', '40000'));
  const maxOutputTokens = Number(getArg('--max-output-tokens', '8192'));
  const useVertex = (getArg('--vertexai', 'true') || 'true').toLowerCase() === 'true';
  const model = getArg('--model', process.env.VERTEX_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const fallbackModel = getArg('--fallback-model', 'gemini-2.5-pro');
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';
  const apiKey = process.env.GEMINI_API_KEY;
  const groupsConcurrency = Math.max(1, Number(getArg('--concurrency', '3')));
  const allowHeuristicFallback = (getArg('--allow-heuristic-fallback', 'false') || 'false').toLowerCase() === 'true';
  // Overflow handling options
  const overflowMode = (getArg('--overflow-mode', 'accept') || 'accept').toLowerCase() as 'accept' | 'regenerate';
  const overflowMaxRatio = Number(getArg('--overflow-max-ratio', '2.0')); // accepter si len <= avgL1 * ratio
  const softRatioStep = Number(getArg('--soft-ratio-step', '0.3')); // réduction de l2-soft-target pour retry (ex: 1.0 -> 0.7)
  // Debug/testing options
  const testMode = ((getArg('--test', 'false') || 'false') as string).toLowerCase() === 'true';
  const maxGroups = Number(getArg('--max-groups', testMode ? '1' : '0')); // 0 => no limit
  const logPath = getArg('--log');
  const logger = await createLogger('compress_l2', logPath);

  const l1Path = path.resolve(process.cwd(), 'artefacts/HMM/compressed', `${slug}.l1.json`);
  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/compressed');
  await fs.mkdir(outDir, { recursive: true });
  const raw = await fs.readFile(l1Path, 'utf8');
  const l1 = JSON.parse(raw) as L1File;
  if (!l1.summaries?.length) throw new Error('No L1 summaries found');

  let groups = chunk(l1.summaries, groupSize);
  if (maxGroups > 0) {
    groups = groups.slice(0, Math.max(1, Math.floor(maxGroups)));
  }
  const l2Summaries: any[] = [];

  // Small helper to extract fields from XML
  const extractFromXml = (xml: string) => {
    const parser = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 100000 });
    const parsed = parser.parse();
    if (!parsed.document?.root || parsed.document.root.name !== 'l2') {
      throw new Error('L2 XML parse failed');
    }
    const root: any = parsed.document.root;
    const collectText = (node: any): string => {
      if (!node) return '';
      if (node.type === 'text' || node.type === 'cdata') return node.content || '';
      return (node.children || []).map(collectText).join('');
    };
    const getTextFrom = (name: string) => {
      const el = root.findElement(name);
      return el ? collectText(el).trim() : '';
    };
    const summary = getTextFrom('summary');
    const tagsEl = root.findElement('tags');
    const tags: string[] = (tagsEl?.findAllElements('tag') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean).slice(0, 12);
    const entitiesEl = root.findElement('entities');
    const persons = (entitiesEl?.findAllElements('p') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
    const artifacts = (entitiesEl?.findAllElements('a') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
    const places = (entitiesEl?.findAllElements('pl') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
    const times = (entitiesEl?.findAllElements('t') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
    const signalsRaw = getTextFrom('signals');
    const extrasEl = root.findElement('extras');
    const omissions = (extrasEl?.findAllElements('omission') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
    const extrasText = extrasEl ? collectText(extrasEl).trim() : '';
    return { summary, tags, persons, artifacts, places, times, signalsRaw, omissions, extrasText };
  };

  // Simple pool runner copied from L1 script
  async function runPool<T, R>(items: T[], worker: (it: T, i: number) => Promise<R>, limit = 3): Promise<R[]> {
    const results: R[] = new Array(items.length) as any;
    let next = 0;
    const running: Promise<void>[] = [];
    async function runOne(i: number) {
      const r = await worker(items[i], i); (results as any)[i] = r;
    }
    while (next < items.length || running.length > 0) {
      while (next < items.length && running.length < limit) {
        const i = next++;
        const p = runOne(i).then(() => {
          const idx = running.indexOf(p as any);
          if (idx >= 0) running.splice(idx, 1);
        });
        running.push(p as any);
      }
      if (running.length > 0) await Promise.race(running);
    }
    return results;
  }

  logger.info(`Starting L2: groups=${groups.length} groupSize=${groupSize} concurrency=${groupsConcurrency} vertex=${useVertex} model=${model} timeoutMs=${callTimeoutMs}`);

  async function processGroup(g: L1Summary[], gi: number) {
    const started = Date.now();
    logger.info(`Processing group ${gi + 1}/${groups.length} ...`);
    const sumChars = g.reduce((a, x) => a + (x.summaryChars || 0), 0);
    const avgChars = Math.max(1, Math.floor(sumChars / Math.max(1, g.length)));

    // Compute dynamic bounds
    const wiggle = Math.max(0, Math.min(0.4, l2Wiggle));
    const target = Math.max(100, Math.floor(avgChars * l2Multiplier));
    const cap = Math.floor(avgChars * 2.0);
    const softTarget = Math.max(50, Math.floor(avgChars * l2SoftTarget));
    const gMin = Math.max(hardMin, 0);
    const gMax = Math.max(gMin + 50, Math.min(cap, Math.floor(target * (1 + wiggle))));
    logger.info(`L2 bounds: size=${g.length} avgL1=${avgChars} target=${target} cap=${cap} bounds=[${gMin},${gMax}] softTarget=${softTarget}`);

    // First attempt
    const genStart = Date.now();
    let meta = await generateMetaSummaryXML(g, { useVertex, model, maxChars: gMax, minChars: gMin, callTimeoutMs, project, location, apiKey, fallbackModel, logger, maxOutputTokens, hintTarget: softTarget, hintCap: cap });
    logger.info(`GenerateMetaSummaryXML duration=${Date.now() - genStart}ms strategy=${meta.strategy}`);
    let xmlOut = meta.xml;
    if (!xmlOut || !xmlOut.includes('<l2')) {
      logger.info(`LLM XML missing or invalid. Strategy=${meta.strategy}.`);
      if (!allowHeuristicFallback) {
        throw new Error(`L2 XML generation failed (no <l2> root). Heuristic fallback disabled.`);
      }
      const pickSent = (t: string) => (t.split(/(?<=[\.!?])\s+/)[0] || t).trim();
      const stitched = g.map(s => pickSent(s.summary)).join(' ');
      const fallbackSummary = stitched.slice(0, gMax);
      xmlOut = `<l2><summary><![CDATA[${fallbackSummary}]]></summary><tags></tags><entities></entities><signals><![CDATA[{}]]></signals></l2>`;
      logger.info(`Heuristic fallback used: stitched-first-sentences length=${fallbackSummary.length}`);
    }

    // Extract
    let { summary, tags, persons, artifacts, places, times, signalsRaw, omissions, extrasText } = extractFromXml(xmlOut);

    // Length checks and overflow handling
    const len = summary.length;
    const ratioToAvg = len / Math.max(1, avgChars);
    if (len < gMin) {
      const msg = `L2 too short: len=${len} < min=${gMin} (avgL1=${avgChars})`;
      logger.info(`❌ ERROR: ${msg}`);
      throw new Error(msg);
    }
    if (len > gMax) {
      const msg = `L2 overflow: len=${len} > max=${gMax} (avgL1=${avgChars} ratio=${ratioToAvg.toFixed(2)})`;
      if (overflowMode === 'accept' && ratioToAvg <= overflowMaxRatio) {
        logger.info(`⚠️ WARNING: ${msg} — ACCEPT (mode=accept, maxRatio=${overflowMaxRatio})`);
      } else if (overflowMode === 'regenerate') {
        const newSoft = Math.max(0.3, Number((l2SoftTarget - softRatioStep).toFixed(2)));
        logger.info(`⚠️ WARNING: ${msg} — REGENERATE with lower soft-target: ${l2SoftTarget} -> ${newSoft}`);
        const gen2Start = Date.now();
        const meta2 = await generateMetaSummaryXML(g, { useVertex, model, maxChars: gMax, minChars: gMin, callTimeoutMs, project, location, apiKey, fallbackModel, logger, maxOutputTokens, hintTarget: Math.max(50, Math.floor(avgChars * newSoft)), hintCap: cap });
        logger.info(`Retry GenerateMetaSummaryXML duration=${Date.now() - gen2Start}ms strategy=${meta2.strategy}`);
        if (meta2.xml && meta2.xml.includes('<l2')) {
          const e2 = extractFromXml(meta2.xml);
          const len2 = e2.summary.length;
          const ratio2 = len2 / Math.max(1, avgChars);
          if (len2 <= gMax && len2 >= gMin) {
            logger.info(`✅ Retry success: len=${len2} within [${gMin},${gMax}] (ratio=${ratio2.toFixed(2)})`);
            summary = e2.summary; tags = e2.tags; persons = e2.persons; artifacts = e2.artifacts; places = e2.places; times = e2.times; signalsRaw = e2.signalsRaw; omissions = e2.omissions; extrasText = e2.extrasText;
          } else if (ratio2 <= overflowMaxRatio) {
            logger.info(`⚠️ Retry still overflow (len=${len2}), ACCEPT due to ratio<=${overflowMaxRatio}`);
            summary = e2.summary; tags = e2.tags; persons = e2.persons; artifacts = e2.artifacts; places = e2.places; times = e2.times; signalsRaw = e2.signalsRaw; omissions = e2.omissions; extrasText = e2.extrasText;
          } else {
            logger.info(`❌ Retry failed: len=${len2} ratio=${ratio2.toFixed(2)} > maxRatio=${overflowMaxRatio}`);
            throw new Error(`L2 overflow after retry (len=${len2} > ${gMax}, ratio=${ratio2.toFixed(2)})`);
          }
        } else {
          logger.info(`❌ Retry generation failed (no <l2>), cannot recover`);
          throw new Error('L2 XML retry generation failed');
        }
      } else if (ratioToAvg <= overflowMaxRatio) {
        logger.info(`⚠️ WARNING: ${msg} — ACCEPT due to ratio<=${overflowMaxRatio}`);
      } else {
        logger.info(`❌ ERROR: ${msg} — REJECT`);
        throw new Error(msg);
      }
    }

    const compressionRatio = summary.length / Math.max(1, sumChars);
    const result = {
      level: 2,
      covers: g.flatMap(x => x.covers || []),
      charCount: sumChars,
      summary,
      summaryChars: summary.length,
      compressionRatio,
      qualityScore: 0.0,
      durationMs: Date.now() - started,
      tags,
      entities: { persons, artifacts, places, times },
      signals: signalsRaw,
      extras: omissions && omissions.length ? { omissions } : (extrasText ? { text: extrasText } : undefined)
    };
    logger.info(`L2 group size=${g.length} sumL1=${sumChars} outLen=${summary.length} ratio=${compressionRatio.toFixed(2)} bounds=[${gMin},${gMax}]`);
    return result;
  }

  const results = await runPool(groups, processGroup, groupsConcurrency);
  for (const r of results) l2Summaries.push(r);

  const out = { slug, produced: l2Summaries.length, summaries: l2Summaries };
  const outPath = path.join(outDir, `${slug}.l2.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Export L2: ${outPath} (count=${l2Summaries.length})`);
  await logger.close();
}

main().catch(err => { console.error(err); process.exit(1); });
