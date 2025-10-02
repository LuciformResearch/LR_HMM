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

  const soft = opts.hintTarget ? `Objectif longueur: ${opts.hintTarget} caractères (cible douce).` : '';
  const cap = opts.hintCap ? `Ne JAMAIS dépasser ${opts.hintCap} caractères (cap dur).` : '';

  const xmlRoot = mode && /^l\d+$/i.test(mode) ? mode : 'l1';
  const minimalSchema = `<${xmlRoot} minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary><![CDATA[...]]></summary>\n</${xmlRoot}>`;
  const wantSignals = (opts as any).includeSignals !== false; // default true
  const wantExtras = (opts as any).includeExtras !== false;   // default true
  const signalsBlock = wantSignals ? `\n  <signals><![CDATA[{\\"themes\\":[...],\\"timeline\\":[{\\"t\\":\\"00:12\\",\\"event\\":\\"...\\"}]}]]></signals>` : '';
  const extrasBlock = wantExtras ? `\n  <extras>\n    <omission>...</omission>\n  </extras>` : '';
  const fullSchema = `<${xmlRoot} minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary><![CDATA[...${opts.minChars}-${opts.maxChars} caractères environ, factuel, sans invention...]]></summary>\n  <tags>\n    <tag>...</tag>\n  </tags>\n  <entities>\n    <persons><p>...</p></persons>\n    <orgs><o>...</o></orgs>\n    <artifacts><a>...</a></artifacts>\n    <places><pl>...</pl></places>\n    <times><t>...</t></times>\n  </entities>${signalsBlock}${extrasBlock}\n</${xmlRoot}>`;
  const schema = opts.directOutput ? minimalSchema : fullSchema;

  await log(`start model=${opts.model} vertex=${!!opts.useVertex} root=${xmlRoot} direct=${!!opts.directOutput} min=${opts.minChars} max=${opts.maxChars} hintTarget=${opts.hintTarget} hintCap=${opts.hintCap} includeSignals=${opts.includeSignals!==false} includeExtras=${opts.includeExtras!==false}`);

  // Persona/prompt preamble
  const profile = opts.profile || 'chat_assistant_fp';
  const persona = opts.personaName || (profile === 'org_voice_fp' ? 'LuciformResearch' : 'ShadeOS');
  const addressing = opts.addressing || (profile === 'neutral_reporter' ? 'third_person' : 'first_person');
  const allow2p = opts.allowSecondPerson === true ? true : false;
  const namingPolicy = opts.namingPolicy || 'allow_from_input_only';
  const names = Array.from(new Set((opts.allowedNames || []).filter(Boolean)));
  const namingLine = namingPolicy === 'forbid_invention'
    ? (names.length ? `N'utilise QUE ces noms: ${names.join(', ')}. N'en invente aucun autre.` : `N'utilise aucun nom propre si absent des Documents.`)
    : namingPolicy === 'allow_from_input_only'
      ? (names.length ? `N'utilise que des noms présents dans les Documents (p.ex. ${names.join(', ')}). N'en invente pas.` : `N'utilise que des noms présents dans les Documents; n'en invente pas.`)
      : `Tu peux utiliser des noms si le contexte l'exige.`;
  const addressLine = addressing === 'first_person'
    ? `Tu impersonnes ${persona} et écris à la première personne (${persona === 'LuciformResearch' ? 'nous' : 'je'}). ${allow2p ? '' : 'N’adresse pas de message directement à la deuxième personne.'}`
    : `Tu écris à la troisième personne, style rapport (ne pas s'adresser au lecteur).`;
  const styleHint = profile === 'chat_assistant_fp'
    ? `Imite le style déjà présent dans les messages de ${persona} (ton, rythme, tournures).`
    : profile === 'org_voice_fp'
      ? `Style interne d'organisation, clair et factuel.`
      : `Style neutre, clair et concis.`;

  const narrativeHint = mode === 'l1' && addressing === 'first_person'
    ? `Style narratif de conversation: raconte le déroulé des échanges en "je" en mentionnant l'interlocuteur par son prénom tel qu'il apparaît dans les Documents (ex.: "Lucie a dit...", "je lui ai répondu..."). Décris l'alternance des tours (ce qui a été demandé, ce que j'ai expliqué ensuite), avec des transitions naturelles. Pas de listes à puces, pas d'adresses en "tu/vous".`
    : '';
  const prompt = `Rôle: ${persona}\n${addressLine}\n${styleHint}\n${namingLine}\n${soft} ${cap}\n${narrativeHint}\nProduis STRICTEMENT un XML conforme au schéma suivant (aucun texte hors XML):\n\n${schema}\n\nDocuments:\n${documents}`;

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
