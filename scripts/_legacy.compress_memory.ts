import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { GoogleGenAI } from '@google/genai';
import { LuciformXMLParser } from '@luciformresearch/xmlparser';
import { generateStructuredXML } from '@/lib/summarization/xmlEngine';
import { runPool } from '@/lib/hmm/runPool';
import { evaluateUnderflow } from '@/lib/hmm/policies';
import { buildChatDoc } from '@/lib/hmm/adapters/chatAdapter';
import { HierarchicalMemoryCompressor } from '@/lib/hmm/compressor';

type ParsedItem = {
  index: number;
  timestamp: string | null;
  role: 'user' | 'assistant' | 'unknown';
  content: string;
  charCount: number;
  lineStart?: number;
  lineEnd?: number;
};

function toConvMessages(block: ParsedItem[]) {
  return block.map(m => ({
    role: m.role === 'unknown' ? 'user' : m.role,
    content: m.content,
    timestamp: new Date().toISOString(),
  }));
}


async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };

  const slug = getArg('--slug', '2025-06-25__orage_codé_textuel')!;
  let windowChars = Number(getArg('--window-chars', '4000'));
  const ensureAssistant = (getArg('--ensure-assistant', 'true') || 'true').toLowerCase() === 'true';
  const maxL1 = getArg('--max-l1') ? Number(getArg('--max-l1')) : Infinity;
  const interlocutor = getArg('--user', 'Lucie');
  const strict = (getArg('--strict', 'true') || 'true').toLowerCase() === 'true';
  const autoWindow = (getArg('--auto-window', 'false') || 'false').toLowerCase() === 'true';
  const structured = (getArg('--structured', 'true') || 'true').toLowerCase() === 'true';
  const structuredXml = (getArg('--structured-xml', 'false') || 'false').toLowerCase() === 'true';
  // Persona/profile + role remap for xmlEngine
  const profile = (getArg('--profile', 'chat_assistant_fp') || 'chat_assistant_fp') as any;
  const personaName = getArg('--persona-name', 'ShadeOS')!;
  const roleMapArg = getArg('--role-map', 'assistant=ShadeOS,user=Lucie')!; // comma-separated
  const roleMap: Record<string,string> = {};
  for (const kv of roleMapArg.split(',').map(s=>s.trim()).filter(Boolean)) {
    const m = kv.split('='); if (m.length === 2) roleMap[m[0]] = m[1];
  }
  const displayRole = (r: 'user'|'assistant'|'unknown') => {
    const key = r === 'unknown' ? 'user' : r;
    return roleMap[key] || (key === 'assistant' ? 'Assistant' : interlocutor);
  };

  const modelOverride = getArg('--model');
  const concurrency = Number(getArg('--concurrency', '3'));
  const maxSummary = Number(getArg('--max-summary', '400')); // longueur max autorisée du résumé
  const targetRatioArg = getArg('--target-ratio');
  const targetRatio = targetRatioArg ? Math.max(0.05, Math.min(0.9, Number(targetRatioArg))) : undefined;
  const timeoutMs = Number(getArg('--timeout-ms', process.env.GEMINI_TIMEOUT_MS || '30000'));
  const useVertex = (getArg('--vertexai', 'false') || 'false').toLowerCase() === 'true';
  const minSummary = Number(getArg('--min-summary', '0'));
  const shortMode = (getArg('--short-mode', 'regenerate') || 'regenerate').toLowerCase() as 'accept' | 'regenerate' | 'error';
  const vertexMaxOutputTokens = Number(getArg('--max-output-tokens', '512'));
  const allowHeuristicFallback = (getArg('--allow-heuristic-fallback', 'true') || 'true').toLowerCase() === 'true';
  // Partial regeneration: comma/range list like "57-68,75,80-83"
  const onlyIndicesArg = getArg('--only-indices');
  const onlyIndices: number[] | undefined = onlyIndicesArg ? (() => {
    const out: number[] = [];
    for (const part of (onlyIndicesArg || '').split(',').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)-(\d+)$/);
      if (m) {
        const a = Number(m[1]); const b = Number(m[2]);
        if (!Number.isNaN(a) && !Number.isNaN(b)) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          for (let i = lo; i <= hi; i++) out.push(i);
        }
      } else {
        const v = Number(part);
        if (!Number.isNaN(v)) out.push(v);
      }
    }
    return Array.from(new Set(out)).sort((a,b)=>a-b);
  })() : undefined;

  if (modelOverride) {
    const cleaned = modelOverride.startsWith('models/') ? modelOverride.slice(7) : modelOverride;
    process.env.GEMINI_MODEL = cleaned;
    console.log(`Using model override: ${cleaned}`);
  }
  // Ensure timeout applies also for fallback path
  process.env.GEMINI_TIMEOUT_MS = String(timeoutMs);

  const inPathArg = getArg('--in');
  const parsedPath = inPathArg
    ? path.resolve(process.cwd(), inPathArg)
    : path.resolve(process.cwd(), 'artefacts/HMM/parsed', `${slug}.json`);
  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/compressed');
  await fs.mkdir(outDir, { recursive: true });

  const raw = await fs.readFile(parsedPath, 'utf8');
  const parsed = JSON.parse(raw) as { items: ParsedItem[]; totals: any };
  const items = parsed.items;

  if (autoWindow) {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for --auto-window');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url);
      const data: any = await res.json();
      const inputTokenLimit = Number((data as any).inputTokenLimit || (data as any).contextWindow || 0);
      if (inputTokenLimit > 0) {
        windowChars = Math.floor(inputTokenLimit * 4 * 0.6);
        console.log(`Auto window from model limits: ${windowChars} chars (model=${model})`);
      } else {
        console.log('Model limits not found; keeping manual windowChars');
      }
    } catch (e) {
      console.log('Failed to fetch model limits; keeping manual windowChars');
    }
  }

  // Build a direct Vertex/AI Studio client (unified via @google/genai)
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const genAI = new GoogleGenAI(useVertex ? { vertexai: true, project, location } : {} as any);

  // Prompt builder (mirrors the assistant persona found in the block) — used for non-XML L1
  function buildPrompt(messages: ParsedItem[], interloc: string, minLen: number | undefined, maxLen: number) {
    const lines: string[] = [];
    const assistantSamples: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'assistant') assistantSamples.push(msg.content);
      const who = msg.role === 'assistant' ? 'Assistant' : interloc;
      lines.push(`${who}: ${msg.content}`);
    }
    const conversationText = lines.join('\n');
    const styleHint = assistantSamples.length > 0
      ? `Imite le style déjà présent dans les messages de l'assistant (ton, rythme, tournures).`
      : `Style par défaut: neutre, clair, concis, chaleureux.`;
    const personaName = 'ShadeOS';
    const lengthLine = minLen && minLen > 0 ? `IMPORTANT: Longueur entre ${minLen} et ${maxLen} caractères.` : `Maximum ${maxLen} caractères.`;
    return `Tu es ${personaName}, le même agent qui s'exprime dans cette conversation.\n${styleHint}\nParle à la première personne ("je"). Réfère-toi à l'utilisateur par son prénom "${interloc}" en narration (ex: "${interloc} m'a parlé de...", "j'ai guidé ${interloc}..."). Ne t'adresse pas directement à elle/lui (évite "tu", "vous", ou les apostrophes).\n\nTâche: Analyse la conversation et crée un résumé narratif fidèle et naturel.\n\nConversation à résumer:\n${conversationText}\n\nContraintes:\n- ${lengthLine}\n- Utilise le même langage que dans la discussion, naturel et fluide\n- Préserve les faits, pas d'invention\n- Ton cohérent avec les messages de l'assistant déjà présents\n\nRésumé narratif (en "je"):`;
  }

  const summaries: any[] = [];
  let current: ParsedItem[] = [];
  let currentChars = 0;

  type Block = { items: ParsedItem[]; charCount: number };
  const blocks: Block[] = [];

  function canFinalize(): boolean {
    if (current.length === 0) return false;
    if (!ensureAssistant) return true;
    return current[current.length - 1].role === 'assistant';
  }

  async function finalizeBlock() {
    const started = Date.now();
    const messages = toConvMessages(current);
    // Déterminer la longueur cible du résumé
    let limit = maxSummary;
    if (targetRatio) {
      const est = Math.floor(currentChars * targetRatio);
      limit = Math.min(maxSummary, Math.max(100, est));
    }
    // Instead of summarizing here, push the block to be processed in parallel later
    blocks.push({ items: [...current], charCount: currentChars });
    current = [];
    currentChars = 0;
  }

  let produced = 0;
  for (const m of items) {
    const nextChars = currentChars + m.charCount;
    if (current.length > 0 && nextChars > windowChars && canFinalize()) {
      await finalizeBlock();
      produced += 1;
      if (produced >= maxL1) break;
    }
    current.push(m);
    currentChars += m.charCount;
  }
  if (produced < maxL1 && canFinalize() && current.length > 0) {
    await finalizeBlock();
  }

  // Build blocks list first (respecting max-l1)
  // Then summarize with limited concurrency, preserving order
  // Load extractors once if needed
  let extractAlgorithmicTags: ((msgs: any[], minK?: number, maxK?: number) => string[]) | undefined;
  let extractArtifacts: ((msgs: any[]) => any[]) | undefined;
  if (structured) {
    try {
      const mods = await import('@/lib/extractors/artifacts');
      extractAlgorithmicTags = mods.extractAlgorithmicTags;
      extractArtifacts = mods.extractArtifacts;
    } catch (err) {
      console.warn('Structured L1: failed to load extractors once:', (err as any)?.message || err);
    }
  }

  async function summarizeBlock(block: Block, idx: number) {
    const started = Date.now();
    // Determine target length
    let limit = maxSummary;
    if (targetRatio) {
      const est = Math.floor(block.charCount * targetRatio);
      limit = Math.min(maxSummary, Math.max(100, est));
    }
    const convMsgs = toConvMessages(block.items);
    // Retry wrapper to absorb transient 429/5xx/timeouts
    const maxAttempts = 3;
    let attempt = 0;
    let lastErr: any;
    let result: any;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        if (structuredXml) {
          // Build documents block for XML engine (via chat adapter)
          const { docs } = buildChatDoc(block.items as any, { roleMap, interlocutor, personaName });
          const xmlRes = await generateStructuredXML('l1', docs, {
            useVertex,
            project,
            location,
            model: modelName,
            maxOutputTokens: Math.max(vertexMaxOutputTokens, 768),
            callTimeoutMs: timeoutMs,
            minChars: minSummary > 0 ? minSummary : 100,
            maxChars: limit,
            userName: interlocutor,
          });
          let xml = xmlRes.xml;
          if (!xml || !xml.includes('<l1')) {
            if (!allowHeuristicFallback) throw new Error('L1 XML generation failed (no <l1> root)');
            // Heuristic fallback: stitch first sentences
            const pickSent = (t: string) => (t.split(/(?<=[\.!?])\s+/)[0] || t).trim();
            const stitched = block.items.map(m => pickSent(m.content)).join(' ');
            const fallback = stitched.slice(0, limit);
            xml = `<l1><summary><![CDATA[${fallback}]]></summary><tags></tags><entities></entities></l1>`;
          }
          // Parse XML
          const parser = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 100000 });
          const parsed = parser.parse();
          const root: any = parsed.document?.root;
          if (!root || root.name !== 'l1') throw new Error('L1 XML parse failed');
          const collectText = (node: any): string => {
            if (!node) return '';
            if (node.type === 'text' || node.type === 'cdata') return node.content || '';
            return (node.children || []).map(collectText).join('');
          };
          const getText = (name: string) => { const el = root.findElement(name); return el ? collectText(el).trim() : ''; };
          const summaryTextXml = getText('summary');
          // Extract tags/entities
          const tagsEl: any = root.findElement('tags');
          const xmlTags: string[] = (tagsEl?.findAllElements('tag') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean).slice(0, 12);
          const entsEl: any = root.findElement('entities');
          const persons = (entsEl?.findAllElements('p') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);
          const orgs = (entsEl?.findAllElements('o') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);
          const places = (entsEl?.findAllElements('pl') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);
          const times = (entsEl?.findAllElements('t') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);

          result = {
            summary: summaryTextXml,
            compressionRatio: summaryTextXml.length / Math.max(1, block.charCount),
            qualityScore: 0.7,
          } as any;

          // Build base object now and enrich later with tags/entities
          let summaryText: string = summaryTextXml;
          const under = evaluateUnderflow(summaryText.length, minSummary, shortMode);
          if (under.decision === 'regenerate') {
            const xmlRes2 = await generateStructuredXML('l1', docs, {
              useVertex, project, location, model: modelName,
              maxOutputTokens: Math.max(vertexMaxOutputTokens, 1024), callTimeoutMs: timeoutMs,
              minChars: Math.max(minSummary, 100), maxChars: limit,
              userName: interlocutor,
            });
            const xml2 = xmlRes2.xml || '';
            if (xml2.includes('<l1')) {
              const p2 = new LuciformXMLParser(xml2, { mode: 'luciform-permissive', maxTextLength: 100000 }).parse();
              const r2: any = p2.document?.root;
              const get2 = (name: string) => { const el = r2?.findElement?.(name); return el ? collectText(el).trim() : ''; };
              const s2 = r2 ? get2('summary') : '';
              if (s2 && s2.length >= minSummary) summaryText = s2;
            }
          } else if (under.decision === 'error') {
            throw new Error(under.message);
          }

          // Compute final base
          const base: any = {
            level: 1,
            index: idx,
            covers: block.items.map(m => m.index),
            charCount: block.charCount,
            summary: summaryText,
            summaryChars: summaryText.length,
            compressionRatio: summaryText.length / Math.max(1, block.charCount),
            qualityScore: 0.7,
            durationMs: Date.now() - started,
            tags: xmlTags,
            entities: { persons, orgs, places, times }
          };
          // Add algorithmic tags/artifacts if requested (merge with XML tags)
          if (structured && extractAlgorithmicTags && extractArtifacts) {
            try {
              const parsedMsgs = block.items.map(m => ({ index: m.index, content: m.content, lineStart: m.lineStart, lineEnd: m.lineEnd }));
              const algoTags = extractAlgorithmicTags(parsedMsgs, 3, 8) || [];
              const tagSet = new Set<string>();
              for (const t of xmlTags) tagSet.add(String(t).toLowerCase());
              for (const t of algoTags) tagSet.add(String(t).toLowerCase());
              const merged = Array.from(tagSet).slice(0, 12);
              base.tags = merged;
              const artifacts = extractArtifacts(parsedMsgs) || [];
              base.artifacts = artifacts.map((a: any) => a.type === 'code_block'
                ? { type: a.type, lang: a.lang, hash: a.hash, messageIndices: a.messageIndices, lineRanges: a.lineRanges }
                : { type: (a as any).type, value: (a as any).value, messageIndices: (a as any).messageIndices, lineRanges: (a as any).lineRanges }
              );
            } catch (err) {
              console.warn('Structured L1(XML) enrichment failed:', (err as any)?.message || err);
            }
          }
          return { idx, base };
        }
        // Non-XML mode now also goes through xmlEngine (directOutput)
        const { docs, allowedNames } = buildChatDoc(block.items as any, { roleMap, interlocutor, personaName });
        const xmlRes = await generateStructuredXML('l1', docs, {
          useVertex,
          project,
          location,
          model: modelName,
          maxOutputTokens: Math.max(vertexMaxOutputTokens, 768),
          callTimeoutMs: timeoutMs,
          minChars: minSummary > 0 ? minSummary : 100,
          maxChars: limit,
          profile,
          personaName,
          addressing: 'first_person',
          allowSecondPerson: false,
          namingPolicy: 'allow_from_input_only',
          allowedNames,
          directOutput: true,
        });
        const xml = xmlRes.xml || '';
        const parser = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 100000 });
        const parsedDirect = parser.parse();
        const rootDirect: any = parsedDirect.document?.root;
        if (!rootDirect || rootDirect.name !== 'l1') throw new Error('L1 direct-output XML parse failed');
        const collectText2 = (node: any): string => { if (!node) return ''; if (node.type === 'text' || node.type === 'cdata') return node.content || ''; return (node.children || []).map(collectText2).join(''); };
        const getText2 = (name: string) => { const el = rootDirect.findElement(name); return el ? collectText2(el).trim() : ''; };
        const text = getText2('summary');
        if (!text) throw new Error('Empty summary');
        result = {
          summary: text,
          compressionRatio: text.length / Math.max(1, block.charCount),
          qualityScore: 0.7
        };
        break;
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e || 'error');
        const backoff = Math.min(4000, 300 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
        console.warn(`L1 summarize attempt ${attempt}/${maxAttempts} failed: ${msg} — retrying in ${backoff}ms`);
        await new Promise(res => setTimeout(res, backoff));
      }
    }
    if (!result) throw lastErr;
    let summaryText: string = result.summary;

    // Handle underflow/truncation via policy
    {
      const under = evaluateUnderflow(summaryText.length, minSummary, shortMode);
      if (under.decision === 'regenerate') {
        try {
          const prompt2 = buildPrompt(block.items, interlocutor, minSummary, limit) + `\n\nIMPORTANT: Assure-toi que le texte atteint au minimum ${minSummary} caractères sans couper la dernière phrase.`;
          const resp2: any = await genAI.models.generateContent({
            model: modelName,
            contents: prompt2,
            generationConfig: { maxOutputTokens: Math.max(vertexMaxOutputTokens, 1024), temperature: 0.2 }
          } as any);
          const text2 = (resp2?.text || resp2?.response?.text || '').trim();
          if (text2 && text2.length >= minSummary) {
            console.log(`✅ L1 retry success: len=${text2.length}`);
            summaryText = text2;
          } else {
            console.warn(`⚠️ L1 retry still short: len=${text2?.length || 0}. ${shortMode === 'accept' ? 'Accepting' : 'Keeping original short summary.'}`);
            if (shortMode === 'error') throw new Error(under.message);
          }
        } catch (e) {
          console.warn(`⚠️ L1 retry failed: ${String((e as any)?.message || e)}`);
          if (shortMode === 'error') throw e;
        }
      } else if (under.decision === 'error') {
        throw new Error(under.message);
      } else if (under.decision === 'accept') {
        console.warn(`⚠️ ${under.message}`);
      }
    }

    const base: any = {
      level: 1,
      index: idx,
      covers: block.items.map(m => m.index),
      charCount: block.charCount,
      summary: summaryText,
      summaryChars: summaryText.length,
      compressionRatio: result.compressionRatio,
      qualityScore: result.qualityScore,
      durationMs: Date.now() - started,
    };
    if (!structuredXml && structured && extractAlgorithmicTags && extractArtifacts) {
      try {
        const parsedMsgs = block.items.map(m => ({ index: m.index, content: m.content, lineStart: m.lineStart, lineEnd: m.lineEnd }));
        const tags = extractAlgorithmicTags(parsedMsgs, 3, 8);
        const artifacts = extractArtifacts(parsedMsgs);
        base.tags = tags;
        base.artifacts = artifacts.map(a => a.type === 'code_block'
          ? { type: a.type, lang: a.lang, hash: a.hash, messageIndices: a.messageIndices, lineRanges: a.lineRanges }
          : { type: (a as any).type, value: (a as any).value, messageIndices: (a as any).messageIndices, lineRanges: (a as any).lineRanges }
        );
      } catch (err) {
        console.warn('Structured L1 enrichment failed:', (err as any)?.message || err);
        base.errors = [String((err as any)?.message || err)];
      }
    }
    // XML experimental placeholder
    if (structuredXml) {
      // no-op for now; fallback is base
    }
    return { idx, base };
  }

  

  // After scanning and pushing blocks, process them
  // If only-indices is set, reuse previous summaries for non-selected indices
  const compressor = new HierarchicalMemoryCompressor();
  const l1EngineOpts = {
    useVertex,
    project,
    location,
    model: modelName,
    callTimeoutMs: timeoutMs,
    maxOutputTokens: vertexMaxOutputTokens,
    minSummary,
    maxSummary,
    targetRatio,
    structuredXml,
    allowHeuristicFallback,
    profile,
    personaName,
    interlocutor,
    roleMap,
    shortMode,
  } as any;

  if (onlyIndices && onlyIndices.length > 0) {
    const outPath = path.join(outDir, `${slug}.l1.json`);
    // Load previous if exists
    let prev: any | undefined;
    try { const rawPrev = await fs.readFile(outPath, 'utf8'); prev = JSON.parse(rawPrev); } catch {}
    if (!prev || !Array.isArray(prev.summaries)) {
      throw new Error(`--only-indices requires an existing L1 file at ${outPath}`);
    }
    // Build a map by covers signature to be resilient to rewindowing
    const prevByCovers = new Map<string, any>();
    for (let i = 0; i < prev.summaries.length; i++) {
      const s = prev.summaries[i];
      const key = JSON.stringify((s && s.covers) || []);
      if (!prevByCovers.has(key)) prevByCovers.set(key, s);
    }
    const final: any[] = new Array(blocks.length);
    // Pre-fill from previous
    for (let i = 0; i < blocks.length; i++) {
      const covers = blocks[i].items.map(m => m.index);
      const key = JSON.stringify(covers);
      const existing = prevByCovers.get(key) || prev.summaries[i];
      if (existing) {
        if (typeof existing.index !== 'number') existing.index = i;
        final[i] = existing;
      }
    }
    // Select indices to regenerate within bounds
    const selected = onlyIndices.filter(i => i >= 0 && i < blocks.length);
    const jobs = selected.map(i => i);
    const selectedBlocks = jobs.map(i => blocks[i]);
    const newSummaries = await compressor.summarizeL1Blocks(selectedBlocks as any, l1EngineOpts, Math.max(1, Number(getArg('--concurrency', '4'))));
    for (let k = 0; k < jobs.length; k++) {
      const idx = jobs[k];
      final[idx] = newSummaries[k];
    }
    // Ensure all non-selected are present
    for (let i = 0; i < final.length; i++) {
      if (!final[i]) throw new Error(`Missing previous summary for block #${i}; rerun without --only-indices or regenerate a larger range.`);
    }
    for (const s of final) summaries.push(s);
  } else {
    const results = await compressor.summarizeL1Blocks(blocks as any, l1EngineOpts, Math.max(1, Number(getArg('--concurrency', '4'))));
    for (const r of results) summaries.push(r as any);
  }

  // Optional algorithmic enrichment (structured mode)
  if (structured && extractAlgorithmicTags && extractArtifacts) {
    try {
      // build quick map from covers signature to block items
      const blockByCovers = new Map<string, Block>();
      for (const b of blocks) {
        const key = JSON.stringify(b.items.map(m => m.index));
        blockByCovers.set(key, b);
      }
      for (const s of summaries as any[]) {
        const key = JSON.stringify((s && s.covers) || []);
        const b = blockByCovers.get(key);
        if (!b) continue;
        const parsedMsgs = b.items.map(m => ({ index: m.index, content: m.content, lineStart: m.lineStart, lineEnd: m.lineEnd }));
        const algoTags = extractAlgorithmicTags(parsedMsgs, 3, 8) || [];
        const artifacts = extractArtifacts(parsedMsgs) || [];
        const tagSet = new Set<string>();
        for (const t of (s.tags || [])) tagSet.add(String(t).toLowerCase());
        for (const t of algoTags) tagSet.add(String(t).toLowerCase());
        s.tags = Array.from(tagSet).slice(0, 12);
        s.artifacts = artifacts.map((a: any) => a.type === 'code_block'
          ? { type: a.type, lang: a.lang, hash: a.hash, messageIndices: a.messageIndices, lineRanges: a.lineRanges }
          : { type: (a as any).type, value: (a as any).value, messageIndices: (a as any).messageIndices, lineRanges: (a as any).lineRanges }
        );
      }
    } catch (err) {
      console.warn('Structured L1 enrichment (post) failed:', (err as any)?.message || err);
    }
  }

  const out = {
    slug,
    windowChars,
    ensureAssistant,
    produced: summaries.length,
    summaries,
  };
  const outPath = path.join(outDir, `${slug}.l1.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Export L1: ${outPath} (count=${summaries.length})`);
  // Force clean exit to avoid lingering keep-alive handles
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
