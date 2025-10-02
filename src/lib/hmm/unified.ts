// Unified Summarize API — types and length-policy helpers (Step 1)

export type Channel = 'chat' | 'document' | 'email' | 'generic';

// High-level input shapes
export type RawDataBlock = {
  id?: string | number;
  text: string; // pre-concatenated content (one window or block)
  covers?: number[]; // indices of source items (optional for traceability)
  meta?: Record<string, any>; // channel-specific metadata (role mapping, author, etc.)
  charCount?: number; // optional, computed if absent
};

export type LSummary = {
  level: number; // 1..k
  covers?: number[]; // source item indices or nested coverage
  sourceChars: number; // chars in input (block/group)
  summary: string;
  summaryChars: number;
  compressionRatio: number; // summaryChars / sourceChars
  qualityScore?: number;
  durationMs?: number;
  tags?: string[];
  entities?: { persons?: string[]; orgs?: string[]; artifacts?: string[]; places?: string[]; times?: string[] };
  signals?: any; // opaque JSON string or object
  extras?: any; // omissions/text metadata
};

// Prompt/persona options (stable across channels)
export type PersonaOptions = {
  profile?: 'chat_assistant_fp' | 'chat_user_fp' | 'email_recipient_fp' | 'org_voice_fp' | 'neutral_reporter';
  personaName?: string;
  addressing?: 'first_person' | 'third_person';
  allowSecondPerson?: boolean;
  namingPolicy?: 'forbid_invention' | 'allow_from_input_only' | 'allow_any';
  allowedNames?: string[];
};

// Engine/runtime options (transport + pacing)
export type SummarizeEngineOptions = PersonaOptions & {
  useVertex: boolean;
  project?: string;
  location?: string;
  model: string;
  maxOutputTokens: number;
  callTimeoutMs: number;
  allowHeuristicFallback?: boolean;
  // Pacing/backoff
  paceDelayMs?: number;
  retryAttempts?: number;
  retryBaseMs?: number;
  retryJitterMs?: number;
  // Structured sections toggles
  generateSignals?: boolean;
  generateExtras?: boolean;
  // Logging
  log?: boolean;
  logFile?: string;
};

// Unifying length policies for L1..Lk
export type LengthPolicies = {
  compressionLevel: number; // target ratio vs input total chars, e.g. 0.3
  wiggle: number;           // +/- tolerance around target, e.g. 0.1 (10%)
  underflowMode: 'accept' | 'regenerate' | 'error';
  overflowMode: 'accept' | 'regenerate' | 'error';
  regenerateRatioStep: number; // step to adjust compressionLevel on retry, e.g. 0.1
  summaryLenRange?: [number, number]; // absolute [min,max] hard caps if provided
  enforceAbsoluteRange?: boolean; // if false, ignore summaryLenRange hard clamping (ratio-only)
};

export type LengthPlan = {
  totalChars: number;
  target: number;   // computed target length in chars (post-range clamp)
  min: number;      // min bound used
  max: number;      // max bound used
  hintTarget: number; // soft target hint for engine
  hintCap: number;    // hard cap hint for engine
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// Compute min/max/targets from unified length policies
export function computeLengthPlan(totalChars: number, p: LengthPolicies): LengthPlan {
  const lvl = clamp(isFinite(p.compressionLevel) ? p.compressionLevel : 0.3, 0.05, 3.0);
  const tgt = Math.max(50, Math.floor(totalChars * lvl));
  const wiggle = clamp(isFinite(p.wiggle) ? p.wiggle : 0.1, 0, 0.8);
  // Base band from target and wiggle
  let min = Math.max(50, Math.floor(tgt * (1 - wiggle)));
  let max = Math.max(min + 50, Math.floor(tgt * (1 + wiggle)));
  // Apply absolute range if provided
  if (p.summaryLenRange && p.enforceAbsoluteRange !== false) {
    const [rminRaw, rmaxRaw] = p.summaryLenRange;
    const rmin = isFinite(rminRaw as number) ? Math.max(50, Math.floor(rminRaw as number)) : undefined;
    const rmax = isFinite(rmaxRaw as number) && (rmaxRaw as number) > 0 ? Math.floor(rmaxRaw as number) : undefined;
    if (rmin != null) min = Math.max(min, rmin);
    if (rmax != null) max = Math.min(max, rmax);
    // If inconsistent, fall back to tight band [rmin,rmax]
    if (rmin != null && rmax != null && min > max) {
      min = Math.min(rmin, rmax);
      max = Math.max(rmin, rmax);
    }
  }
  if (min > max) min = max; // final guard
  const hintTarget = clamp(tgt, min, max);
  const hintCap = Math.max(min, max);
  return { totalChars, target: hintTarget, min, max, hintTarget, hintCap };
}

export type LengthDecision = {
  decision: 'accept' | 'regenerate' | 'reject';
  newCompressionLevel?: number; // suggested next level if regenerate
  message: string;
};

// Evaluate produced length w.r.t plan + policies; return action + possible next compressionLevel
export function evaluateLengthOutcome(
  producedLen: number,
  plan: LengthPlan,
  policies: LengthPolicies
): LengthDecision {
  const { min, max, target } = plan;
  if (producedLen >= min && producedLen <= max) {
    return { decision: 'accept', message: `Within bounds: len=${producedLen} in [${min},${max}] (target=${target})` };
  }
  const under = producedLen < min;
  const over = producedLen > max;
  if (under) {
    if (policies.underflowMode === 'accept') {
      return { decision: 'accept', message: `Underflow accepted: len=${producedLen} < min=${min}` };
    }
    if (policies.underflowMode === 'error') {
      return { decision: 'reject', message: `Underflow error: len=${producedLen} < min=${min}` };
    }
    const step = Math.max(0.01, policies.regenerateRatioStep || 0.1);
    const next = (policies.compressionLevel || 0.3) + step;
    return { decision: 'regenerate', newCompressionLevel: Number(next.toFixed(3)), message: `Underflow: increase compressionLevel by +${step}` };
  }
  if (over) {
    if (policies.overflowMode === 'accept') {
      return { decision: 'accept', message: `Overflow accepted: len=${producedLen} > max=${max}` };
    }
    if (policies.overflowMode === 'error') {
      return { decision: 'reject', message: `Overflow error: len=${producedLen} > max=${max}` };
    }
    const step = Math.max(0.01, policies.regenerateRatioStep || 0.1);
    const next = (policies.compressionLevel || 0.3) - step;
    return { decision: 'regenerate', newCompressionLevel: Number(next.toFixed(3)), message: `Overflow: decrease compressionLevel by -${step}` };
  }
  return { decision: 'accept', message: 'No action needed' };
}

// Stubs for future steps (Step 3/4): preparation and post-processing hooks
export type PrepareBlocksOptions = {
  channel: Channel;
  // Chat
  interlocutor?: string;
  roleMap?: Record<string, string>;
  // Document / Email (placeholders for future)
  authorType?: 'person' | 'organisation';
  authorName?: string;
  orgName?: string;
  emailMode?: 'sender' | 'recipient';
};

export type PreparedContext = {
  channel: Channel;
  blocks: RawDataBlock[]; // ready for summarize(L1)
  promptHint?: string;    // channel-specific hint, e.g., narrative-first-person for chat
};

export type PostProcessOptions = {
  enableAlgorithmicTags?: boolean;
  minK?: number;
  maxK?: number;
};

// ===== Implementation core (Step 2): unified summarize over blocks or summary groups =====

import { generateStructuredXML } from '@/lib/summarization/xmlEngine';
import { LuciformXMLParser } from '@luciformresearch/xmlparser';
import { collectText, getText, parseTags, parseEntities, parseExtras } from '@/lib/hmm/xmlHelpers';
import { runPool } from '@/lib/hmm/runPool';

export type SummarizeExecOptions = {
  level?: number;              // summarizeBlocks: ignored (forced to 1); groups: >=2
  concurrency?: number;        // parallel workers per chunk
  directOutput?: boolean;      // if true, minimize schema (summary only)
};

// Helper: pick a quick fallback from the first sentence(s)

function firstSentences(text: string, maxChars: number): string {
  const pick = (t: string) => (t.split(/(?<=[\.!?])\s+/)[0] || t).trim();
  const stitched = pick(text);
  return stitched.slice(0, maxChars);
}

function ensureCharCount(v?: number, text?: string): number {
  if (typeof v === 'number' && isFinite(v) && v > 0) return Math.floor(v);
  return Math.max(0, (text || '').length);
}

// Shared helper to DRY L1 and Lk summarization flows
async function summarizeText(
  docs: string,
  sourceChars: number,
  covers: number[] | undefined,
  level: number,
  engine: SummarizeEngineOptions,
  policies: LengthPolicies,
  opts: { structured: boolean }
): Promise<LSummary> {
  async function log(msg: string) {
    try {
      if (!engine.log || !engine.logFile) return;
      const line = `[${new Date().toISOString()}] [unified] ${msg}\n`;
      const { appendFile } = await import('fs/promises');
      await appendFile(engine.logFile, line);
    } catch {}
  }
  const useStructured = opts.structured !== false;
  const rootTag = `l${Math.max(1, Math.floor(level || 1))}`;
  let plan = computeLengthPlan(sourceChars, policies);
  await log(`summarizeText start level=${level} root=${rootTag} sourceChars=${sourceChars} plan[min=${plan.min},max=${plan.max},target=${plan.hintTarget}] structured=${useStructured}`);

  const ratioOnly = policies.enforceAbsoluteRange === false;
  const call = async (minChars: number, maxChars: number) => {
    const res = await generateStructuredXML(rootTag, docs, {
      useVertex: engine.useVertex,
      project: engine.project,
      location: engine.location,
      model: engine.model,
      maxOutputTokens: engine.maxOutputTokens,
      callTimeoutMs: engine.callTimeoutMs,
      minChars,
      maxChars,
      hintTarget: plan.hintTarget,
      hintCap: ratioOnly ? undefined : plan.hintCap,
      profile: engine.profile,
      personaName: engine.personaName,
      addressing: engine.addressing,
      allowSecondPerson: engine.allowSecondPerson,
      namingPolicy: engine.namingPolicy,
      allowedNames: engine.allowedNames,
      directOutput: !useStructured,
      paceDelayMs: engine.paceDelayMs,
      retryAttempts: engine.retryAttempts,
      retryBaseMs: engine.retryBaseMs,
      retryJitterMs: engine.retryJitterMs,
      includeSignals: engine.generateSignals !== false,
      includeExtras: engine.generateExtras !== false,
      log: engine.log,
      logFile: engine.logFile,
    });
    let xml = res.xml || '';
    if ((!xml || !xml.includes(`<${rootTag}`)) && engine.allowHeuristicFallback) {
      const fallback = firstSentences(docs, plan.max);
      const sig = engine.generateSignals === false ? '' : '\n  <signals><![CDATA[{}]]></signals>';
      const ext = engine.generateExtras === false ? '' : '\n  <extras></extras>';
      xml = `<${rootTag}><summary><![CDATA[${fallback}]]></summary><tags></tags><entities></entities>${sig}${ext}\n</${rootTag}>`;
      await log(`fallback used root=${rootTag} fallbackLen=${fallback.length}`);
    }
    return xml;
  };

  // First attempt
  // In ratio-only mode, do not enforce tight bounds: allow a wide container but avoid infinity
  const minForCall = ratioOnly ? 0 : plan.min;
  const maxForCall = ratioOnly ? Math.max(256, Math.ceil(plan.hintTarget * 2)) : plan.max;
  let xml = await call(minForCall, maxForCall);
  const parsed0 = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 300000 }).parse();
  const r0: any = parsed0.document?.root;
  if (!r0) throw new Error('XML parse failed');
  const s0 = getText(r0, 'summary');
  let produced = s0.length;
  let decision = evaluateLengthOutcome(produced, plan, policies);
  await log(`first summary len=${produced} decision=${decision.decision}${decision.newCompressionLevel!=null?` nextCompression=${decision.newCompressionLevel}`:''}`);

  // Optional regenerate with adjusted compressionLevel
  if (decision.decision === 'regenerate' && typeof decision.newCompressionLevel === 'number' && !ratioOnly) {
    const newPolicies: LengthPolicies = { ...policies, compressionLevel: decision.newCompressionLevel };
    plan = computeLengthPlan(sourceChars, newPolicies);
    xml = await call(plan.min, plan.max);
    await log(`regenerate called new plan[min=${plan.min},max=${plan.max},target=${plan.hintTarget}]`);
  }

  // Parse final
  const p2 = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 300000 }).parse();
  const r2: any = p2.document?.root;
  if (!r2) throw new Error('Final XML parse failed');
  const summaryText = getText(r2, 'summary');
  const tags = useStructured ? parseTags(r2, 12) : [];
  const { persons, orgs, artifacts, places, times } = useStructured ? parseEntities(r2) : { persons: [], orgs: [], artifacts: [], places: [], times: [] };
  const signals = useStructured ? getText(r2, 'signals') : undefined;
  const { omissions, text: extrasText } = useStructured ? parseExtras(r2) : { omissions: [], text: '' };

  const out: LSummary = {
    level: Math.max(1, Math.floor(level || 1)),
    covers,
    sourceChars,
    summary: summaryText,
    summaryChars: summaryText.length,
    compressionRatio: summaryText.length / Math.max(1, sourceChars),
    tags,
    entities: { persons, orgs, artifacts, places, times },
    signals,
    extras: (omissions && omissions.length) ? { omissions } : (extrasText ? { text: extrasText } : undefined)
  };
  await log(`summarizeText end level=${out.level} summaryChars=${out.summaryChars} ratio=${out.compressionRatio.toFixed(3)} tags=${out.tags?.length||0}`);
  return out;
}

export async function summarizeBlocks(
  blocks: RawDataBlock[],
  engine: SummarizeEngineOptions,
  policies: LengthPolicies,
  opts: SummarizeExecOptions
): Promise<LSummary[]> {
  const concurrency = Math.max(1, opts.concurrency || 3);
  return runPool(blocks, async (b) => {
    const sourceChars = ensureCharCount(b.charCount, b.text);
    return summarizeText(
      b.text,
      sourceChars,
      b.covers,
      1,
      engine,
      policies,
      { structured: !(opts.directOutput === true) }
    );
  }, concurrency);
}

export async function summarizeSummaryGroups(
  groups: LSummary[][],
  engine: SummarizeEngineOptions,
  policies: LengthPolicies,
  opts: SummarizeExecOptions
): Promise<LSummary[]> {
  const concurrency = Math.max(1, opts.concurrency || 3);
  function toDocs(g: LSummary[]): string {
    return g.map((s, i) => `---\n[Item #${i + 1} | ${s.summaryChars} chars]\n${s.summary}`).join('\n');
  }

  return runPool(groups, async (g) => {
    const totalChars = g.reduce((a, x) => a + (x.summaryChars || 0), 0);
    const docs = toDocs(g);
    const covers = g.flatMap(x => x.covers || []);
    const level = Math.max(2, opts.level || 2);
    return summarizeText(
      docs,
      totalChars,
      covers,
      level,
      engine,
      policies,
      { structured: !(opts.directOutput === true) }
    );
  }, concurrency);
}

// ===== Step 2.5: façade summarize() that dispatches by input type =====
export async function summarize(
  input: RawDataBlock[] | LSummary[][],
  engine: SummarizeEngineOptions,
  policies: LengthPolicies,
  opts: SummarizeExecOptions
): Promise<LSummary[]> {
  if (!Array.isArray(input) || input.length === 0) return [];
  const first: any = input[0];
  if (first && typeof first === 'object' && 'text' in first) {
    return summarizeBlocks(input as RawDataBlock[], engine, policies, opts);
  }
  return summarizeSummaryGroups(input as LSummary[][], engine, policies, opts);
}

// Batched façade with optional pacing between chunks (for rate limiting)
export type SummarizeBatchOptions = SummarizeExecOptions & {
  batchDelayMs?: number;
  onlyIndices?: number[]; // optional 0-based indices filter
};

export async function summarizeBatched(
  input: RawDataBlock[] | LSummary[][],
  engine: SummarizeEngineOptions,
  policies: LengthPolicies,
  opts: SummarizeBatchOptions
): Promise<LSummary[]> {
  if (!Array.isArray(input) || input.length === 0) return [];
  const chunkSize = Math.max(1, opts.concurrency || 3);
  const delay = Math.max(0, opts.batchDelayMs || 0);

  // Optional indices filtering
  let workset: { idx: number; item: any }[] = (input as any[]).map((item, idx) => ({ idx, item }));
  if (opts.onlyIndices && Array.isArray(opts.onlyIndices) && opts.onlyIndices.length > 0) {
    const set = new Set(opts.onlyIndices.filter(n => Number.isFinite(n) && n >= 0).map(n => Math.floor(n)));
    workset = workset.filter(w => set.has(w.idx));
  }
  try {
    if (engine.log && engine.logFile) {
      const { appendFile } = await import('fs/promises');
      await appendFile(engine.logFile, `[${new Date().toISOString()}] [unified] batched start total=${(input as any[]).length} filtered=${workset.length} chunkSize=${chunkSize} delay=${delay}\n`);
    }
  } catch {}
  const results: LSummary[] = [];
  for (let i = 0; i < workset.length; i += chunkSize) {
    const slice = workset.slice(i, Math.min(i + chunkSize, workset.length));
    const sliceItems = slice.map(s => s.item);
    const sliceResults = await summarize(sliceItems as any, engine, policies, { ...opts, concurrency: Math.min(chunkSize, slice.length) });
    results.push(...sliceResults);
    if (i + chunkSize < workset.length && delay > 0) {
      await new Promise(res => setTimeout(res, delay));
    }
  }
  try {
    if (engine.log && engine.logFile) {
      const { appendFile } = await import('fs/promises');
      await appendFile(engine.logFile, `[${new Date().toISOString()}] [unified] batched end produced=${results.length}\n`);
    }
  } catch {}
  return results;
}


// ===== Step 3: prepareBlocks / preparePrompt (channel-aware) =====

export type ChatTurn = {
  role: 'assistant' | 'user' | 'unknown';
  content: string;
  index?: number; // original index for traceability
  charCount?: number;
};

export type PrepareChatOptions = PrepareBlocksOptions & {
  windowChars: number;
  ensureAssistant?: boolean;
  maxBlocks?: number | 'infinity';
};

function displayNameFor(role: 'assistant' | 'user' | 'unknown', opts: PrepareChatOptions): string {
  const roleMap = opts.roleMap || {};
  if (role === 'assistant') return roleMap['assistant'] || (opts as any).personaName || 'Assistant';
  return roleMap['user'] || opts.interlocutor || 'User';
}

function renderChatBlock(turns: ChatTurn[], opts: PrepareChatOptions): string {
  const lines: string[] = [];
  for (const t of turns) {
    const who = displayNameFor(t.role, opts);
    lines.push(`${who}: ${t.content}`);
  }
  return lines.join('\n');
}

export function prepareBlocksChat(turns: ChatTurn[], opts: PrepareChatOptions): PreparedContext {
  const blocks: RawDataBlock[] = [];
  let current: ChatTurn[] = [];
  let chars = 0;
  let produced = 0;
  const maxB = opts.maxBlocks === 'infinity' || opts.maxBlocks == null ? Infinity : Number(opts.maxBlocks);
  const ensureAssistant = opts.ensureAssistant !== false; // default true

  const canFinalize = () => current.length > 0 && (!ensureAssistant || current[current.length - 1].role === 'assistant');
  const finalize = () => {
    const text = renderChatBlock(current, opts);
    const covers = current.map(t => (typeof t.index === 'number' ? t.index : -1)).filter(n => n >= 0);
    blocks.push({ text, covers, charCount: text.length, meta: { channel: 'chat' } });
    current = [];
    chars = 0;
  };

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const c = typeof t.charCount === 'number' ? t.charCount! : t.content.length;
    const next = chars + c;
    if (current.length > 0 && next > opts.windowChars && canFinalize()) {
      finalize();
      produced += 1;
      if (produced >= maxB) break;
    }
    current.push(t);
    chars += c;
  }
  if (produced < maxB && canFinalize() && current.length > 0) finalize();

  const promptHint = preparePrompt('chat', {
    profile: (opts as any).profile || 'chat_assistant_fp',
    personaName: (opts as any).personaName || 'ShadeOS',
    addressing: 'first_person',
    allowSecondPerson: false,
    namingPolicy: (opts as any).namingPolicy || 'allow_from_input_only',
    allowedNames: (opts as any).allowedNames || [opts.interlocutor, (opts as any).personaName].filter(Boolean) as string[],
    interlocutor: opts.interlocutor,
  });
  return { channel: 'chat', blocks, promptHint };
}

export type PrepareDocumentOptions = PrepareBlocksOptions & {
  windowChars?: number;
  text: string;
};

export function prepareBlocksDocument(opts: PrepareDocumentOptions): PreparedContext {
  // Minimal naive split for now; can improve with paragraph-aware chunking later.
  const win = Math.max(500, opts.windowChars || 8000);
  const blocks: RawDataBlock[] = [];
  for (let i = 0; i < opts.text.length; i += win) {
    const chunk = opts.text.slice(i, i + win);
    blocks.push({ text: chunk, charCount: chunk.length, meta: { channel: 'document' } });
  }
  const promptHint = preparePrompt('document', {
    profile: (opts as any).profile || 'neutral_reporter',
    personaName: (opts as any).personaName || (opts.orgName || opts.authorName || 'Reporter'),
    addressing: (opts.authorType === 'organisation') ? 'first_person' : 'first_person',
    allowSecondPerson: false,
    namingPolicy: (opts as any).namingPolicy || 'allow_from_input_only',
    allowedNames: (opts as any).allowedNames || [],
  });
  return { channel: 'document', blocks, promptHint };
}

export type PrepareEmailOptions = PrepareBlocksOptions & {
  windowChars?: number;
  text: string;
  senderName?: string;
  recipientName?: string;
};

export function prepareBlocksEmail(opts: PrepareEmailOptions): PreparedContext {
  const win = Math.max(500, opts.windowChars || 6000);
  const blocks: RawDataBlock[] = [];
  for (let i = 0; i < opts.text.length; i += win) {
    const chunk = opts.text.slice(i, i + win);
    blocks.push({ text: chunk, charCount: chunk.length, meta: { channel: 'email' } });
  }
  const promptHint = preparePrompt('email', {
    profile: (opts as any).profile || 'email_recipient_fp',
    personaName: (opts as any).personaName || (opts.recipientName || opts.senderName || 'Correspondant'),
    addressing: 'first_person',
    allowSecondPerson: false,
    namingPolicy: (opts as any).namingPolicy || 'allow_from_input_only',
    allowedNames: (opts as any).allowedNames || [opts.senderName, opts.recipientName].filter(Boolean) as string[],
  });
  return { channel: 'email', blocks, promptHint };
}

export function preparePrompt(channel: Channel, persona: PersonaOptions & { interlocutor?: string }): string {
  const personaName = persona.personaName || 'ShadeOS';
  const interloc = persona.interlocutor || 'User';
  const namingLine = persona.namingPolicy === 'forbid_invention'
    ? (persona.allowedNames && persona.allowedNames.length ? `N'utilise QUE ces noms: ${persona.allowedNames.join(', ')}. N'en invente aucun autre.` : `N'utilise aucun nom propre si absent des Documents.`)
    : persona.namingPolicy === 'allow_any'
      ? `Tu peux introduire des noms si le contexte l'exige.`
      : (persona.allowedNames && persona.allowedNames.length
          ? `N'utilise que des noms présents dans les Documents (p.ex. ${persona.allowedNames.join(', ')}). N'en invente pas.`
          : `N'utilise que des noms présents dans les Documents; n'en invente pas.`);

  if (channel === 'chat') {
    return [
      `Tu es ${personaName}, le même agent que dans la conversation ci‑dessous.`,
      `Adresse: première personne ("je"), sans s'adresser en deuxième personne (pas de "tu/vous").`,
      `Style narratif de conversation: raconte le déroulé des échanges, en mentionnant l'interlocuteur par son prénom (ex.: "${interloc} a dit...", "je lui ai répondu...").`,
      namingLine
    ].join('\n');
  }
  if (channel === 'document') {
    return [
      `Tu écris un résumé de document au nom de ${personaName}.`,
      `Voix de rapport, factuelle, en première personne adaptée (je/nous) selon le contexte.`,
      namingLine
    ].join('\n');
  }
  if (channel === 'email') {
    return [
      `Tu écris un résumé d'email au point de vue de ${personaName}.`,
      `Voix adaptée au rôle (expéditeur/récipiendaire), première personne, sans adresse directe.`,
      namingLine
    ].join('\n');
  }
  return `Style neutre, clair et concis. ${namingLine}`;
}
