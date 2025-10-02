import { GoogleGenAI } from '@google/genai';

// Accept any structured level tag, e.g., 'l1', 'l2', 'l3', ...
export type XmlEngineMode = string;

export type XmlEngineOpts = {
  useVertex: boolean;
  project?: string;
  location?: string;
  model: string;
  maxOutputTokens: number;
  callTimeoutMs: number;
  minChars: number;
  maxChars: number;
  hintTarget?: number;
  hintCap?: number;
  // Persona/Profiles for abstraction across channels
  profile?: 'chat_assistant_fp' | 'chat_user_fp' | 'email_recipient_fp' | 'org_voice_fp' | 'neutral_reporter';
  personaName?: string; // e.g. ShadeOS, Recipient, LuciformResearch
  addressing?: 'first_person' | 'third_person';
  allowSecondPerson?: boolean;
  namingPolicy?: 'forbid_invention' | 'allow_from_input_only' | 'allow_any';
  allowedNames?: string[];
  // If true, return a minimal XML wrapper with only <summary> (no full structured schema)
  directOutput?: boolean;
  // Pacing + retry controls
  paceDelayMs?: number;          // optional delay before each call (rate pacing)
  retryAttempts?: number;        // attempts on 429/timeout (default 2)
  retryBaseMs?: number;          // base backoff (default 500ms)
  retryJitterMs?: number;        // added random jitter (default 250ms)
  includeSignals?: boolean;      // include <signals> section (default true)
  includeExtras?: boolean;       // include <extras> section (default true)
  // Logging
  log?: boolean;
  logFile?: string;
  // Debug-prompt: if true, only log the prompt text (skip API)
  debugPrompt?: boolean;
  promptOutFile?: string; // where to write the prompt
};

/**
 * Minimal shared XML engine (initially for L1). Uses @google/genai for Vertex/Studio.
 */
export async function generateStructuredXML(
  mode: XmlEngineMode,
  documents: string,
  opts: XmlEngineOpts
): Promise<{ xml: string; strategy: 'primary' | 'retry' | 'none'; }> {
  async function log(msg: string) {
    try {
      if (!opts.log || !opts.logFile) return;
      const line = `[${new Date().toISOString()}] [xmlEngine] ${msg}\n`;
      const { appendFile } = await import('fs/promises');
      await appendFile(opts.logFile, line);
    } catch {}
  }
  const nonVertexApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  const ai = new GoogleGenAI(
    opts.useVertex
      ? ({ vertexai: true, project: opts.project, location: opts.location } as any)
      : (nonVertexApiKey ? ({ apiKey: nonVertexApiKey } as any) : ({} as any))
  );

  const soft = opts.hintTarget ? `Pour la section <summary> UNIQUEMENT: objectif ${Math.round(opts.hintTarget)} caractères (cible douce).` : '';
  const cap = opts.hintCap ? `Pour <summary> UNIQUEMENT: ne JAMAIS dépasser ${opts.hintCap} caractères (cap dur).` : '';

  const xmlRoot = mode && /^l\d+$/i.test(mode) ? mode : 'l1';
  const targetLenAttr = Math.max(0, Math.round(opts.hintTarget || Math.max(0, Math.floor((opts.minChars + opts.maxChars) / 2))))
  const minimalSchema = `<${xmlRoot} minChars=\"${Math.max(0, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary targetLen=\"${targetLenAttr}\"><![CDATA[...]]></summary>\n</${xmlRoot}>`;
  const wantSignals = (opts as any).includeSignals !== false; // default true
  const wantExtras = (opts as any).includeExtras !== false;   // default true
  const signalsBlock = wantSignals ? `\n  <signals><![CDATA[{\\"themes\\":[...],\\"timeline\\":[{\\"t\\":\\"00:12\\",\\"event\\":\\"...\\"}]}]]></signals>` : '';
  const extrasBlock = wantExtras ? `\n  <extras>\n    <omission>...</omission>\n  </extras>` : '';
  const fullSchema = `<${xmlRoot} minChars=\"${Math.max(0, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary targetLen=\"${targetLenAttr}\"><![CDATA[...${opts.hintTarget ? Math.round(opts.hintTarget) : `${opts.minChars}-${opts.maxChars}`} caractères environ, factuel, sans invention...]]></summary>\n  <tags>\n    <tag>...</tag>\n  </tags>\n  <entities>\n    <persons><p>...</p></persons>\n    <orgs><o>...</o></orgs>\n    <artifacts><a>...</a></artifacts>\n    <places><pl>...</pl></places>\n    <times><t>...</t></times>\n    <other><ot>...</ot></other>\n  </entities>${signalsBlock}${extrasBlock}\n</${xmlRoot}>`;
  const schema = opts.directOutput ? minimalSchema : fullSchema;

  await log(`start model=${opts.model} vertex=${!!opts.useVertex} root=${xmlRoot} direct=${!!opts.directOutput} min=${opts.minChars} max=${opts.maxChars} hintTarget=${opts.hintTarget} hintCap=${opts.hintCap} includeSignals=${opts.includeSignals!==false} includeExtras=${opts.includeExtras!==false}`);

  // Persona/prompt preamble (condensed Role/Situation/Summary rules)
  const profile = opts.profile || 'chat_assistant_fp';
  const persona = opts.personaName || (profile === 'org_voice_fp' ? 'LuciformResearch' : 'ShadeOS');
  const names = Array.from(new Set((opts.allowedNames || []).filter(Boolean)));
  const otherNames = names.filter(n => n && n !== persona);
  const interlocutorsHint = otherNames.length ? otherNames.join(', ') : "l'utilisateur";
  const docType = profile === 'email_recipient_fp' ? 'email' : (String(profile).includes('chat') ? 'transcript de chat' : 'document');
  const roleLine = `Rôle: ${persona}, Agent d'Introspection Mémoire Long Terme`;
  const situationLine = `Situation: Résumé introspectif d’un document de type ${docType}. (Conversation avec ${interlocutorsHint})`;
  const summaryRules = `Dans <summary>, écris à la 1ʳᵉ personne, introspectif, factuel, fidèle au ton de ${persona}, sans "tu/vous" (sauf en citations), sans invention ni variantes de noms.`;
  const prompt = `${roleLine}\n${situationLine}\n${summaryRules}\n${soft} ${cap}\nProduis STRICTEMENT un XML conforme au schéma suivant (aucun texte hors XML):\n\n${schema}\n\nDocuments:\n${documents}`;

  // Debug-prompt mode: write prompt and return immediately
  if (opts.debugPrompt) {
    try {
      if (opts.promptOutFile) {
        const { appendFile } = await import('fs/promises');
        const sep = `\n\n===== PROMPT @ ${new Date().toISOString()} | root=${xmlRoot} | min=${opts.minChars} max=${opts.maxChars} hintTarget=${opts.hintTarget} hintCap=${opts.hintCap} model=${opts.model} vertex=${!!opts.useVertex} =====\n`;
        await appendFile(opts.promptOutFile, sep + prompt + "\n");
      }
      await log(`debugPrompt=true wrote prompt to ${opts.promptOutFile || '(none)'}`);
    } catch {}
    return { xml: '', strategy: 'none' };
  }

  const retryAttempts = Math.max(1, opts.retryAttempts ?? 2);
  const baseMs = Math.max(0, opts.retryBaseMs ?? 500);
  const jitterMs = Math.max(0, opts.retryJitterMs ?? 250);

  for (let i = 0; i < retryAttempts; i++) {
    const approxTokensFromChars = (chars: number) => Math.max(128, Math.ceil((chars || 512) / 4) + 64);
    // Prefer hintTarget when present (ratio-only may omit hintCap)
    const baseChars = (opts.hintTarget && opts.hintTarget > 0) ? opts.hintTarget : (opts.hintCap || opts.maxChars || 512);
    const dynamicTokens = approxTokensFromChars(baseChars);
    // Clamp to a safe ceiling to avoid runaway
    const clampedDynamic = Math.min(dynamicTokens, 8192);
    const chosenMax = Math.max(opts.maxOutputTokens, clampedDynamic, i === 0 ? 0 : 1024);
    const a = { model: opts.model, maxOutputTokens: chosenMax, temperature: i === 0 ? 0.3 : 0.2 };
    if ((opts.paceDelayMs ?? 0) > 0) {
      await new Promise(r => setTimeout(r, opts.paceDelayMs as number));
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.callTimeoutMs);
    try {
      await log(`attempt ${i+1}/${retryAttempts} maxTokens=${a.maxOutputTokens} temp=${a.temperature} timeoutMs=${opts.callTimeoutMs}`);
      const resp: any = await ai.models.generateContent({
        model: a.model,
        contents: prompt,
        generationConfig: { maxOutputTokens: a.maxOutputTokens, temperature: a.temperature }
      } as any);
      const out = (resp?.text || resp?.response?.text || '').trim();
      await log(`attempt ${i+1} responseLen=${out.length} hasRoot=${out.includes(`<${xmlRoot}`)}`);
      if (out.includes(`<${xmlRoot}`)) return { xml: out, strategy: i === 0 ? 'primary' : 'retry' };
    } finally { clearTimeout(t); }
    // backoff before next attempt
    if (i + 1 < retryAttempts) {
      const wait = baseMs * Math.pow(2, i) + Math.floor(Math.random() * (jitterMs + 1));
      await log(`backoff waitMs=${wait}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  await log(`end strategy=none`);
  return { xml: '', strategy: 'none' };
}
